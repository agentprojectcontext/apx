// Extension plugins: one process each, started with Node's permission model (reads its own folder, writes its data
// folder, starts nothing). It gets the events it watches and, if it asked, is asked for context on owner turns.
// See DECISIONS.md#d-018
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CoreEvent } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { ContextInput, Hooks } from "../engine/hooks.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import { extSecret } from "./extensions.ts";

const RUNNER = path.join(import.meta.dirname, "plugin-runner.mjs");
/** Events larger than this are not sent (a plugin gets summaries of huge messages from elsewhere). */
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RESTARTS = 3;
const MAX_LINE = 64 * 1024;
/** A context answer later than this is dropped (the turn has gone on without it). */
const CONTEXT_WAIT_MS = 2500;
const RESTART_WINDOW_MS = 5 * 60_000;

type Live = {
  ext: ExtensionRecord;
  child: ChildProcess;
  status: "running" | "error";
  error?: string | undefined;
  pending: Map<number, (text: string | undefined) => void>;
  restarts: number[];
  stopping: boolean;
};

export type PluginStatus = { status: "off" | "running" | "error"; error?: string | undefined };

export function createPlugins(deps: {
  home: string;
  secrets: Secrets;
  bus: Bus;
  hooks: Hooks;
  log: Log;
  /** The extension as approved now (enabled, files unchanged), or undefined: checked again before every restart. */
  approved: (id: string) => ExtensionRecord | undefined;
  /** Whether a thread is a contact's sealed chat: plugins never see those. */
  sealed: (threadId: string) => boolean;
}) {
  const { log } = deps;
  const live = new Map<string, Live>();
  const errors = new Map<string, string>();
  let nextId = 1;

  function launch(ext: ExtensionRecord, restarts: number[] = []): void {
    const plugin = ext.manifest.plugin;
    if (!plugin) return;
    // Real paths: Node checks permissions on the resolved file, so a symlinked home (/var → /private/var) must match.
    const dir = fs.realpathSync(ext.dir);
    const entry = path.resolve(dir, plugin.entry);
    const raw = path.join(deps.home, "extension-data", ext.id);
    fs.mkdirSync(raw, { recursive: true });
    const data = fs.realpathSync(raw);
    const env: Record<string, string> = {
      APX_DATA_DIR: data,
      APX_PLUGIN_NETWORK: plugin.network ? "1" : "0",
      PATH: process.env.PATH ?? "",
    };
    for (const s of ext.manifest.secrets) {
      const value = deps.secrets.resolve(`secret://${extSecret(ext.id, s.name)}`);
      if (value) env[`APX_SECRET_${s.name.toUpperCase()}`] = value;
    }
    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${dir}`,
        `--allow-fs-read=${fs.realpathSync(RUNNER)}`,
        `--allow-fs-read=${data}`,
        `--allow-fs-write=${data}`,
        RUNNER,
        entry,
      ],
      { cwd: data, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const l: Live = { ext, child, status: "running", pending: new Map(), restarts, stopping: false };
    live.set(ext.id, l);
    errors.delete(ext.id);
    const onLine = (line: string) => {
      let msg: { t?: string; id?: number; text?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.t === "context" && typeof msg.id === "number") {
        l.pending.get(msg.id)?.(typeof msg.text === "string" ? msg.text : undefined);
        l.pending.delete(msg.id);
      } else if (msg.t === "log") log.info({ extension: ext.id, text: String(msg.text).slice(0, 500) }, "plugin");
    };
    // Lines are capped: a plugin that floods its output without newlines is stopped, never buffered without end.
    let partial = "";
    child.stdout?.on("data", (d: Buffer) => {
      partial += String(d);
      let nl = partial.indexOf("\n");
      while (nl >= 0) {
        onLine(partial.slice(0, nl));
        partial = partial.slice(nl + 1);
        nl = partial.indexOf("\n");
      }
      if (partial.length > MAX_LINE) {
        partial = "";
        stderr = "it wrote a line too long";
        child.kill();
      }
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-2000);
    });
    child.on("exit", (code) => {
      for (const done of l.pending.values()) done(undefined);
      l.pending.clear();
      if (live.get(ext.id) === l) live.delete(ext.id);
      if (l.stopping) return;
      const why = stderr.trim().split("\n").at(-1) || `exited with ${code}`;
      const recent = [...l.restarts.filter((t) => Date.now() - t < RESTART_WINDOW_MS), Date.now()];
      log.warn({ extension: ext.id, err: why.slice(0, 300) }, "plugin stopped");
      if (recent.length > MAX_RESTARTS) {
        errors.set(ext.id, why.slice(0, 300));
        deps.hooks.release(ext.id);
        return;
      }
      setTimeout(() => {
        if (live.has(ext.id) || errors.has(ext.id) || !wanted.has(ext.id)) return;
        // Restarted only as approved: still on, and with the files that were turned on.
        const now = deps.approved(ext.id);
        if (!now) {
          wanted.delete(ext.id);
          deps.hooks.release(ext.id);
          return;
        }
        launch(now, recent);
      }, 1000).unref();
    });
    child.stdin?.on("error", () => {});
  }

  function write(l: Live, msg: unknown): void {
    if (l.child.stdin?.writable) l.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  /** Extensions that should be running (enabled with a plugin). */
  const wanted = new Map<string, ExtensionRecord>();

  const threadOf = (e: CoreEvent): string | undefined =>
    e.type === "message.created"
      ? e.message.thread_id
      : e.type === "thread.updated"
        ? e.thread.id
        : e.type === "run.updated"
          ? e.run.thread_id
          : undefined;
  const off = deps.bus.on((e: CoreEvent) => {
    const thread = threadOf(e);
    if (thread && deps.sealed(thread)) return;
    for (const l of live.values()) {
      if (!(l.ext.manifest.plugin?.observe as string[] | undefined)?.includes(e.type)) continue;
      const line = JSON.stringify({ t: "event", event: e });
      if (line.length <= MAX_EVENT_BYTES) write(l, { t: "event", event: e });
    }
  });

  /** Asks a running plugin for a turn's context; undefined when it is not running or does not answer in time. */
  const ask = (extId: string, input: ContextInput) =>
    new Promise<string | undefined>((resolve) => {
      const l = live.get(extId);
      if (!l) return resolve(undefined);
      const id = nextId++;
      l.pending.set(id, resolve);
      write(l, { t: "context", id, input });
      setTimeout(() => {
        if (l.pending.delete(id)) resolve(undefined);
      }, CONTEXT_WAIT_MS).unref();
    });

  return {
    ask,
    /** Starts the plugin of an enabled extension (taking the context point if it asks for it). */
    start(ext: ExtensionRecord): void {
      const plugin = ext.manifest.plugin;
      if (!plugin || live.has(ext.id)) return;
      if (plugin.context)
        deps.hooks.provideContext({ owner: ext.id, name: ext.manifest.name, fn: (input) => ask(ext.id, input) });
      wanted.set(ext.id, ext);
      try {
        launch(ext);
      } catch (err) {
        errors.set(ext.id, errorMessage(err, 300));
      }
    },
    stop(id: string): void {
      wanted.delete(id);
      errors.delete(id);
      deps.hooks.release(id);
      const l = live.get(id);
      if (!l) return;
      l.stopping = true;
      l.child.kill();
      live.delete(id);
    },
    contextOwner: () => deps.hooks.contextOwner(),
    /** Marks a plugin as failed (it could not start); APX goes on without it. */
    fail(id: string, error: string): void {
      errors.set(id, error);
      deps.hooks.release(id);
    },
    status(id: string): PluginStatus {
      const err = errors.get(id);
      if (err) return { status: "error", error: err };
      return { status: live.has(id) ? "running" : "off" };
    },
    close(): void {
      off();
      for (const id of [...live.keys()]) this.stop(id);
    },
  };
}

export type Plugins = ReturnType<typeof createPlugins>;
