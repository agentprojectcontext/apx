// The public address channels' webhooks reach (Teams, LINE): Tailscale Funnel, an ngrok tunnel, or the owner's own
// URL in front of the webhook listener (transport/hooks.ts). The owner's choice is kept and applied again at every
// start. See DECISIONS.md#d-139
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { type HookError, type HookMode, tailscaleDnsName, type WebhooksState } from "@apx/protocol";
import { findTailscale, type TailscaleRun, tailscaleRunner } from "./access.ts";
import type { Store } from "./domain/store.ts";
import { CallError } from "./errors.ts";
import type { Log } from "./log.ts";

/** Funnel's own HTTPS port for webhooks: 443 stays what `apx tailscale connect` serves to the tailnet. */
const FUNNEL_PORT = 8443;
/** How long ngrok may take to say its address before the owner is told it failed. */
export const NGROK_WAIT_MS = 15_000;
/** How long what this computer has (Tailscale connected, ngrok installed) is trusted: the panel asks every 10 s. */
const PROBE_TTL_MS = 30_000;
/** A tunnel that died is started again after 2 s, then 4, 8… up to a minute between tries. */
const retryAfter = (attempt: number) => Math.min(60_000, 2_000 * 2 ** attempt);

/** A running ngrok: its log lines as they come, its end, and a way to stop it. */
export type NgrokProcess = {
  onLine(fn: (line: string) => void): void;
  onExit(fn: (code: number | null) => void): void;
  stop(): void;
};
export type NgrokStart = (args: string[]) => NgrokProcess;

export function findNgrok(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = process.platform === "win32" ? "ngrok.exe" : "ngrok";
  const dirs = [...(env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean);
  for (const dir of dirs) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  return undefined;
}

const ngrokSpawner =
  (bin: string): NgrokStart =>
  (args) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return {
      onLine: (fn) => {
        for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", fn);
      },
      onExit: (fn) => child.on("exit", fn),
      stop: () => child.kill(),
    };
  };

/** What one ngrok log line (JSON, `--log-format json`) says: its public URL, or why it failed. */
export function ngrokLine(line: string): { url?: string; error?: string } {
  let j: { msg?: string; url?: string; lvl?: string; err?: string };
  try {
    j = JSON.parse(line);
  } catch {
    return {};
  }
  if (j.msg === "started tunnel" && j.url?.startsWith("https://")) return { url: j.url };
  if (j.lvl === "eror" || j.lvl === "crit") return { error: (j.err || j.msg || "ngrok failed").slice(0, 300) };
  return {};
}

export function createWebhooks(deps: {
  store: Store;
  /** The webhook listener's port, once it listens. */
  port: () => number;
  log: Log;
  tailscale?: TailscaleRun | undefined;
  ngrok?: NgrokStart | undefined;
  /** How long to wait before starting a dead tunnel again, by attempt (tests pass a short one). */
  retryMs?: ((attempt: number) => number) | undefined;
}) {
  const tailscaleRun = (): TailscaleRun | undefined => {
    if (deps.tailscale) return deps.tailscale;
    const bin = findTailscale();
    return bin ? tailscaleRunner(bin) : undefined;
  };
  const ngrokStart = (): NgrokStart | undefined => {
    if (deps.ngrok) return deps.ngrok;
    const bin = findNgrok();
    return bin ? ngrokSpawner(bin) : undefined;
  };
  const retryMs = deps.retryMs ?? retryAfter;
  let url: string | undefined;
  let error: { code: HookError; detail?: string | undefined } | undefined;
  let tunnel: NgrokProcess | undefined;
  /** ngrok gave an address it had not given before: the first one, or another after it started again. */
  let fresh = false;
  let retry: NodeJS.Timeout | undefined;
  let attempts = 0;
  let probed: { at: number; found: Promise<Probe> } | undefined;

  const saved = () => deps.store.settings.read("webhooks");
  const fail = (code: HookError, detail?: string) => {
    error = { code, ...(detail ? { detail: detail.slice(0, 300) } : {}) };
  };
  const tailscaleDns = async (run: TailscaleRun | undefined) => {
    const st = await run?.(["status", "--json"]);
    return st?.ok ? tailscaleDnsName(st.out) : undefined;
  };
  type Probe = { tailscale: { installed: boolean; connected: boolean }; ngrok: { installed: boolean } };
  /** What this computer has, asked at most every PROBE_TTL_MS: the CLI and PATH scans stay off the panel's polling. */
  function probe(): Promise<Probe> {
    if (probed && Date.now() - probed.at < PROBE_TTL_MS) return probed.found;
    const run = tailscaleRun();
    const found = tailscaleDns(run).then((dns) => ({
      tailscale: { installed: Boolean(run), connected: Boolean(dns) },
      ngrok: { installed: Boolean(ngrokStart()) },
    }));
    probed = { at: Date.now(), found };
    return found;
  }

  function stopNgrok() {
    clearTimeout(retry);
    retry = undefined;
    const t = tunnel;
    tunnel = undefined;
    t?.stop();
  }

  /** A tunnel that died while ngrok is still the choice comes back, later each time it dies again. */
  function restartLater(domain: string | undefined) {
    const wait = retryMs(attempts++);
    deps.log.info({ wait_ms: wait, attempt: attempts }, "webhooks: ngrok starts again");
    retry = setTimeout(() => {
      retry = undefined;
      if (saved().mode === "ngrok" && !tunnel) void startNgrok(domain);
    }, wait);
    retry.unref();
  }

  /** Starts ngrok and resolves once it says its address (or failed, or took too long). */
  function startNgrok(domain: string | undefined): Promise<void> {
    const start = ngrokStart();
    if (!start) {
      fail("ngrok_missing");
      return Promise.resolve();
    }
    const args = ["http", `127.0.0.1:${deps.port()}`, "--log", "stdout", "--log-format", "json"];
    const t = start(domain ? [...args, "--url", domain] : args);
    tunnel = t;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (tunnel === t && !url) fail("ngrok_timeout");
        resolve();
      }, NGROK_WAIT_MS);
      timer.unref();
      t.onLine((line) => {
        if (tunnel !== t) return;
        const said = ngrokLine(line);
        if (said.url) {
          url = said.url;
          error = undefined;
          attempts = 0;
          // A free account keeps one address across starts: only a new one has to be pasted into the platform.
          const kept = saved();
          fresh = kept.ngrok_last !== url;
          if (fresh) deps.store.settings.write("webhooks", { ...kept, ngrok_last: url });
          deps.log.info({ url }, "webhooks: ngrok address up");
          clearTimeout(timer);
          resolve();
        } else if (said.error && !url) fail("ngrok_failed", said.error);
      });
      t.onExit((code) => {
        if (tunnel !== t) return;
        tunnel = undefined;
        url = undefined;
        fresh = false;
        if (!error) fail("ngrok_stopped", `exit ${code ?? "signal"}`);
        deps.log.warn({ error }, "webhooks: ngrok stopped");
        clearTimeout(timer);
        restartLater(domain);
        resolve();
      });
    });
  }

  /** Makes the saved choice true on this computer: the address comes up, or `error` says why not. */
  async function apply(): Promise<void> {
    const { mode, url: own, domain } = saved();
    stopNgrok();
    url = undefined;
    error = undefined;
    fresh = false;
    attempts = 0;
    probed = undefined;
    if (mode === "custom") url = own?.replace(/\/+$/, "");
    if (mode === "ngrok") await startNgrok(domain);
    if (mode === "tailscale") {
      const run = tailscaleRun();
      const dns = await tailscaleDns(run);
      if (!run) fail("tailscale_missing");
      else if (!dns) fail("tailscale_offline");
      else {
        const r = await run(["funnel", "--bg", `--https=${FUNNEL_PORT}`, `http://127.0.0.1:${deps.port()}`]);
        if (r.ok) url = `https://${dns}:${FUNNEL_PORT}`;
        else fail("funnel_failed", r.out);
      }
    }
  }

  async function state(): Promise<WebhooksState> {
    const { mode, domain } = saved();
    return {
      mode,
      ...(url ? { url } : {}),
      url_may_change: mode === "ngrok" && Boolean(url) && fresh,
      port: deps.port(),
      ...(domain ? { domain } : {}),
      ...(error ? { error: error.code, ...(error.detail ? { error_detail: error.detail } : {}) } : {}),
      ...(await probe()),
    };
  }

  return {
    state,
    /** The base the channels' addresses hang from (`<base>/hooks/<channel id>`), while one is up. */
    base: () => url,
    /** The saved choice, applied at start (a failure only shows in the state). */
    start: () =>
      apply().catch((err: unknown) => {
        fail("failed", String(err));
      }),
    async set(o: { mode: HookMode; url?: string | undefined; domain?: string | undefined }): Promise<WebhooksState> {
      if (o.mode === "custom" && !o.url?.startsWith("https://"))
        throw new CallError({ code: "bad_request", message: "a public address needs an https:// URL" });
      const { mode: before, ngrok_last } = saved();
      // Only undo what APX set up: other Funnel or serve configs on this machine are not APX's.
      if (before === "tailscale" && o.mode !== "tailscale")
        await tailscaleRun()?.(["funnel", `--https=${FUNNEL_PORT}`, "off"]);
      deps.store.settings.write("webhooks", {
        mode: o.mode,
        ...(o.mode === "custom" && o.url ? { url: o.url } : {}),
        ...(o.mode === "ngrok" && o.domain ? { domain: o.domain } : {}),
        ...(ngrok_last ? { ngrok_last } : {}),
      });
      await apply();
      return state();
    },
    close: stopNgrok,
  };
}

export type Webhooks = ReturnType<typeof createWebhooks>;
