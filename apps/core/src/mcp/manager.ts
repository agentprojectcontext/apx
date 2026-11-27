// Connections to MCP servers, opened when an agent's turn needs them and closed when idle, and their tools as APX
// tools: same argument check, same policy, results marked as outside data.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Thread } from "@apx/protocol";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { lineage, parentOf } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, errorMessage, unavailable } from "../errors.ts";
import { commandEnv, SECRET_NAME } from "../harness/env.ts";
import type { Log } from "../log.ts";
import { waitForExit } from "../process-exit.ts";
import { onPath } from "../programs.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";
import { cap, untrusted } from "../tools/result.ts";
import { type Confirm, type Effect, invalidArguments, type ScopedThread, type Tool } from "../tools/types.ts";
import { type McpTool, mcpApproval, mcpServerApproval, serverApprovalId } from "./approval.ts";
import { ARGS_SECRET, type McpDef, mcpConfig } from "./config.ts";
import { connectionErrors, MCP_SECRET_REF } from "./connection-errors.ts";
import { fileRefs, fillFileArgs, hasFileRefs, type OpenFile, refOf } from "./file-args.ts";
import { createStderrLogs } from "./logs.ts";
import { createProcessExits } from "./process-exits.ts";
import { watchSignIn } from "./sign-in.ts";
import { allowsAll, forgetOpened, type OpenedBy, openNew, setMcpToolMode } from "./tool-mode.ts";
import { closeWindowsTree } from "./windows-process-tree.ts";

const CONNECT_MS = 20_000;
const CALL_MS = 120_000;
const IDLE_MS = 10 * 60_000;
/** How long a server that asked the owner to sign in is kept running, so the browser's answer still finds it. */
const SIGN_IN_MS = 5 * 60_000;

type Connected = { client: Client; tools: McpTool[]; errorMessage: (error: unknown) => string };

type Conn = {
  key: string;
  hash: string;
  client?: Client;
  tools: McpTool[];
  status: "starting" | "ready" | "error" | "needs-sign-in";
  error?: string;
  errorMessage?: (error: unknown) => string;
  /** The page the server asked the owner to open, while it waits for them. */
  signInUrl?: string;
  /** Ends a start still under way, its process with it (one waiting on a sign-in lives for minutes). */
  stop?: () => Promise<void>;
  used: number;
  failedAt?: number;
  ready?: Promise<void>;
};

/**
 * A server that failed is tried again after this, not on every turn: soon enough that fixing it outside its definition
 * (a secret set, a program installed) shows on the next message, never a restart.
 */
const RETRY_MS = 30_000;

const SIGN_IN_FIRST = "it waits for you to sign in: use Sign in";
const SIGN_IN_ASKED = "it asked you to sign in: finish on the page it opened in your browser";

export type McpStatus = {
  name: string;
  scope: "global" | "project";
  project_id?: string;
  only: boolean;
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
  trusted: boolean;
  status: "off" | "needs-approval" | "disabled" | "starting" | "ready" | "error" | "needs-sign-in";
  sign_in_url?: string;
  tools: number;
  tool_names: string[];
  tool_permission_mode: "unknown" | "ask" | "all" | "some";
  vars: Array<{ name: string; set: boolean }>;
  off_here: boolean;
  /** A global server: the projects it is turned off in (it is on in every other one). */
  off_in: string[];
  error?: string;
};

/** The stored secrets a definition names, in order, once each. */
const secretNames = (d: McpDef): string[] => [
  ...new Set(
    [...Object.values(d.env), ...Object.values(d.headers), ...d.args, d.url ?? ""].flatMap((v) =>
      [...v.matchAll(MCP_SECRET_REF)].map((m) => m[1] as string),
    ),
  ),
];

/**
 * When an MCP tool waits for the owner. MCP's defaults: a tool may change things and may be destructive unless it
 * says otherwise; a project's server describes itself, so its "read-only" claim does not skip the policy.
 */
function mcpConfirm(readOnly: boolean, destructive: boolean | undefined, scope: McpDef["scope"]): Confirm {
  if (readOnly) return scope === "global" ? "never" : "untrusted";
  return destructive === false ? "untrusted" : "ask";
}

/** MCP tool names become `mcp_<server>_<tool>`, within what every model accepts. */
const toolName = (server: string, tool: string) => `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** Whether a failed check only trips on file references (`apx-file:…`, med_ ids), which are filled in at run. */
function onlyRefs(error: z.ZodError, raw: Record<string, unknown>): boolean {
  const at = (path: PropertyKey[]) =>
    path.reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Record<PropertyKey, unknown>)[k] : undefined),
      raw,
    );
  return error.issues.every((i) => refOf(at(i.path)) !== undefined);
}

export function createMcp(deps: {
  store: Store;
  secrets: Secrets;
  log: Log;
  /** Where a stdio server with no folder of its own starts: what it saves under a relative path lands there. */
  workDir: string;
  /** The files an agent of a thread may hand to a tool (file-args.ts); without it, references are refused. */
  files?: (thread: ScopedThread) => OpenFile;
}) {
  const config = mcpConfig(deps.store);
  const conns = new Map<string, Conn>();
  const closing = new Map<Conn, Promise<void>>();
  const blocked = new Set<string>();
  const tests = new Map<string, Set<{ abort: () => void; done: Promise<void> }>>();
  const processes = createProcessExits();
  const stderr = createStderrLogs();
  const keyOf = (d: McpDef) => `${d.scope}:${d.project_id ?? ""}:${d.values_of ?? ""}:${d.name}`;

  /** A project's own values first, then its parent's for a subproject (domain/projects.ts lineage). */
  const valuesIn = (projectId: string | undefined) => lineage(deps.store.projects, projectId);
  /** An owner's server in a project with its own value for one of its variables runs as a copy of its own there. */
  const inProject = (d: McpDef, projectId: string | undefined): McpDef =>
    projectId &&
    valuesIn(projectId).some((p) => secretNames(d).some((n) => deps.secrets.has(`secret://${projectSecretName(p, n)}`)))
      ? { ...d, values_of: projectId }
      : d;

  /** Never the core's own folder, which is wherever it was started from (a checkout, the owner's home). */
  const ownDir = (name: string) => {
    const dir = path.join(deps.workDir, name.replace(/[^\w-]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  /**
   * Starts a server and lists its tools, within CONNECT_MS; one that asks the owner to sign in gets SIGN_IN_MS from
   * then, and `onSignIn` hears it. The caller owns the client and closes it.
   */
  async function connect(d: McpDef, onSignIn?: (url: string) => void, signal?: AbortSignal): Promise<Connected> {
    if (d.args.some((a) => a.includes("secret://"))) throw new Error(ARGS_SECRET);
    if (d.missingSettings?.length) throw new Error(`Set the required settings: ${d.missingSettings.join(", ")}`);
    const optional = new Set(d.optionalSecrets ?? []);
    const missing = secretNames(d).filter(
      (name) => !optional.has(name) && !deps.secrets.resolveIn(`secret://${name}`, valuesIn(d.values_of)),
    );
    if (missing.length)
      throw new Error(
        `Set the required secret${missing.length === 1 ? "" : "s"}: ${missing.map((name) => d.secretLabels?.[name] ?? name).join(", ")}`,
      );
    const errors = connectionErrors((ref) => {
      const value = deps.secrets.resolveIn(ref, valuesIn(d.values_of));
      return value ?? (ref.startsWith("secret://") && optional.has(ref.slice(9)) ? "" : undefined);
    });
    const fill = (value: string) =>
      errors.fill(value).replace(/\{\{apx-literal-\d+\}\}/g, (token) => d.literalSettings?.[token] ?? token);
    const resolve = (values: Record<string, string>) =>
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fill(v)]));
    // Loaded with the first server: a core with none never loads the MCP client.
    const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    ]);
    const client = new Client({ name: "apx", version: "2" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fail!: (err: Error) => void;
    const deadline = new Promise<never>((_, reject) => {
      fail = reject;
    });
    // Nobody waits on it once the start is over: a late sign-in line must not become an unhandled rejection.
    deadline.catch(() => {});
    signal?.addEventListener("abort", () => fail(new Error("closed")), { once: true });
    if (signal?.aborted) fail(new Error("closed"));
    const arm = (ms: number, why: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(why)), ms);
    };
    let transport: InstanceType<typeof StreamableHTTPClientTransport> | InstanceType<typeof StdioClientTransport>;
    let trackProcess: (() => void) | undefined;
    try {
      if (d.url)
        transport = new StreamableHTTPClientTransport(new URL(fill(d.url)), {
          requestInit: { headers: resolve(d.headers) },
        });
      else {
        const env = resolve(d.env);
        // Windows starts it through cmd, which hides a missing program as a closed connection: say so first.
        const cmd = d.command ?? "";
        if (process.platform === "win32" && !/[\\/]/.test(cmd) && !onPath(cmd)) throw new Error(`spawn ${cmd} ENOENT`);
        const stdio = new StdioClientTransport({
          command: d.command ?? "",
          args: d.args.map(fill),
          // Only what the definition gives it, on top of an environment without credentials.
          env: { ...commandEnv(), ...env },
          cwd: d.cwd ?? ownDir(d.name),
          stderr: "pipe",
        });
        if (process.platform === "win32") closeWindowsTree(stdio);
        trackProcess = processes.watch(keyOf(d), stdio);
        // A server may print what it was given: its secrets and credential-like variables are masked in its log.
        const hidden = [
          ...secretNames(d).map((n) => deps.secrets.resolveIn(`secret://${n}`, valuesIn(d.values_of)) ?? ""),
          ...Object.keys(d.env)
            .filter((k) => SECRET_NAME.test(k) || d.env[k]?.includes("secret://"))
            .map((k) => env[k] ?? ""),
        ];
        stderr.follow(keyOf(d), stdio.stderr, hidden);
        watchSignIn(stdio.stderr, (url) => {
          arm(SIGN_IN_MS, `sign-in not finished in ${SIGN_IN_MS / 60_000} min`);
          onSignIn?.(url);
        });
        transport = stdio;
      }
      arm(CONNECT_MS, `no answer in ${CONNECT_MS / 1000}s`);
      // Our deadline ends the start, not the SDK's own minute: a sign-in may take longer.
      const connecting = client.connect(transport, { timeout: SIGN_IN_MS });
      trackProcess?.();
      await Promise.race([connecting, deadline]);
      arm(CONNECT_MS, `no tool list in ${CONNECT_MS / 1000}s`);
      const { tools } = await Promise.race([client.listTools(undefined, { timeout: CONNECT_MS }), deadline]);
      return { client, tools: tools as McpTool[], errorMessage: errors.message };
    } catch (err) {
      await client.close().catch(() => {});
      throw new Error(errors.message(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /** The tools a server listed last, kept so its list and permissions show before it starts again. */
  const seen = (d: McpDef) => {
    const s = deps.store.settings.read("mcp_tools_seen")[keyOf(d)];
    return s?.hash === d.hash ? s.tools : undefined;
  };
  const remember = (d: McpDef, tools: McpTool[]) => {
    const all = deps.store.settings.read("mcp_tools_seen");
    const next = { hash: d.hash, tools: tools.map((t) => ({ name: t.name, key: mcpApproval(d, t).key })) };
    if (JSON.stringify(all[keyOf(d)]) === JSON.stringify(next)) return;
    all[keyOf(d)] = next;
    deps.store.settings.write("mcp_tools_seen", all);
  };
  const forget = (mine: (key: string) => boolean) => {
    const all = deps.store.settings.read("mcp_tools_seen");
    const keep = Object.fromEntries(Object.entries(all).filter(([k]) => !mine(k)));
    if (Object.keys(keep).length !== Object.keys(all).length) deps.store.settings.write("mcp_tools_seen", keep);
  };
  /**
   * "all": the server's own grant for every agent (new tools included); "some": tools approved one by one for every
   * agent; "ask": none; "unknown": no grant and no tools seen yet.
   */
  const permissionMode = (d: McpDef, known: Array<{ key: string }>): McpStatus["tool_permission_mode"] => {
    const server = mcpServerApproval(d);
    if (deps.store.approvals.allows(server)) return "all";
    if (!known.length) return "unknown";
    return known.some((t) => deps.store.approvals.allows({ ...server, key: t.key })) ? "some" : "ask";
  };

  /**
   * A server that asked the owner to sign in is not started again by itself, a restart included, until they sign in
   * from the panel (mcp.signIn) or its definition changes: every start would open their browser once more.
   */
  const signInKey = (d: McpDef) => `mcp_sign_in:${keyOf(d)}`;
  const waitsSignIn = (d: McpDef) => deps.store.settings.get(signInKey(d)) === d.hash;
  const setWaitsSignIn = (d: McpDef, on: boolean) => {
    if (on || deps.store.settings.get(signInKey(d)) !== undefined)
      deps.store.settings.set(signInKey(d), on ? d.hash : "");
  };

  /**
   * Follows a start into its connection: `c.ready` settles once it is ready, failed, or waits on the owner's sign-in;
   * a sign-in the owner finishes later still makes it ready.
   */
  function follow(
    d: McpDef,
    c: Conn,
    start: (onSignIn: (url: string) => void) => Promise<Connected>,
    abort: () => void,
  ) {
    let settle!: () => void;
    c.ready = new Promise<void>((r) => {
      settle = r;
    });
    const mine = () => conns.get(c.key) === c;
    const started = start((url) => {
      if (!mine()) return;
      c.status = "needs-sign-in";
      c.signInUrl = url;
      setWaitsSignIn(d, true);
      deps.log.info({ mcp: d.name }, "MCP server waits for the owner to sign in");
      settle();
    });
    const finished = started
      .then(
        async ({ client, tools, errorMessage }) => {
          // Replaced or dropped while starting: this process is nobody's now.
          if (!mine()) return void (await client.close().catch(() => {}));
          c.client = client;
          c.tools = tools;
          c.errorMessage = errorMessage;
          c.status = "ready";
          remember(d, tools);
          c.signInUrl = undefined;
          setWaitsSignIn(d, false);
        },
        (err) => {
          if (!mine()) return;
          c.failedAt = Date.now();
          c.error = errorMessage(err);
          // Its page answers nobody now.
          c.signInUrl = undefined;
          // A sign-in left unfinished still waits on the owner, never on a retry.
          if (c.status !== "needs-sign-in") c.status = "error";
          deps.log.warn({ mcp: d.name, err: c.error }, "MCP server did not start");
        },
      )
      .finally(() => {
        c.stop = undefined;
        settle();
      });
    c.stop = async () => {
      abort();
      await finished;
    };
  }

  /** Closes a connection, or the start still opening it. */
  function closeConn(c: Conn): Promise<void> {
    const existing = closing.get(c);
    if (existing) return existing;
    const done = (async () => {
      await c.stop?.();
      await c.client?.close().catch(() => {});
    })();
    closing.set(c, done);
    void done.then(
      () => closing.delete(c),
      () => closing.delete(c),
    );
    return done;
  }

  const blockKey = (d: Pick<McpDef, "scope" | "project_id" | "name">) => `${d.scope}:${d.project_id ?? ""}:${d.name}`;

  /** The live connection for a definition, (re)opened when missing, failed or its definition changed. */
  function ensure(d: McpDef): Conn {
    if (blocked.has(blockKey(d))) throw conflict("This server is being updated; try again shortly");
    const key = keyOf(d);
    let c = conns.get(key);
    if (c && c.hash !== d.hash) {
      void closeConn(c);
      c = undefined;
    }
    if (!c && waitsSignIn(d)) {
      c = { key, hash: d.hash, tools: [], status: "needs-sign-in", used: Date.now(), ready: Promise.resolve() };
      conns.set(key, c);
    }
    if (!c || (c.status === "error" && Date.now() - (c.failedAt ?? 0) > RETRY_MS)) {
      c = { key, hash: d.hash, tools: [], status: "starting", used: Date.now() };
      conns.set(key, c);
      const ac = new AbortController();
      follow(
        d,
        c,
        (onSignIn) => connect(d, onSignIn, ac.signal),
        () => ac.abort(),
      );
    }
    c.used = Date.now();
    return c;
  }

  async function invoke(d: McpDef, t: McpTool, args: Record<string, unknown>, signal: AbortSignal, project?: string) {
    const current = defsFor(project).find((x) => keyOf(x) === keyOf(d));
    if (!current || current.hash !== d.hash || !current.enabled || !config.trusted(current))
      throw new Error("MCP server approval or definition changed; start a new turn");
    // The connection may have been closed while the turn waited (an owner's long confirmation): reopen it.
    const c = ensure(d);
    await c.ready;
    if (!c.client)
      throw new Error(
        c.status === "needs-sign-in"
          ? `${d.name} waits for the owner to sign in (APX panel → MCP → ${d.name} → Sign in)`
          : `${d.name} is not connected${c.error ? `: ${c.error}` : ""}`,
      );
    const next = defsFor(project).find((x) => keyOf(x) === keyOf(d));
    const liveTool = c.tools.find((x) => x.name === t.name);
    if (
      !next ||
      next.hash !== d.hash ||
      !next.enabled ||
      !config.trusted(next) ||
      !liveTool ||
      mcpApproval(next, liveTool).key !== mcpApproval(d, t).key
    )
      throw new Error("MCP approval or tool contract changed; start a new turn");
    try {
      return (await c.client.callTool({ name: t.name, arguments: args }, undefined, {
        timeout: CALL_MS,
        signal: signal,
      })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
    } catch (error) {
      throw new Error(c.errorMessage?.(error) ?? errorMessage(error));
    }
  }

  function adapt(d: McpDef, t: McpTool, name: string): Tool {
    const ro = t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint !== true;
    const effect: Effect = ro ? "none" : "external";
    const confirm = mcpConfirm(ro, t.annotations?.destructiveHint, d.scope);
    let check: z.ZodType | undefined;
    try {
      check = z.fromJSONSchema(t.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
    } catch {
      check = undefined;
    }
    const label = t.annotations?.title ?? t.title ?? t.name;
    return {
      name,
      approval: mcpApproval(d, t),
      description: `[${d.name}] ${t.description ?? label}`.slice(0, 1024),
      parameters: t.inputSchema,
      effect,
      // Sending the owner's files out waits for them while outside content is in the turn, even for a read-only tool.
      confirm: (args) => (confirm === "never" && hasFileRefs(args) ? "untrusted" : confirm),
      deadlineMs: CALL_MS + 5_000,
      parse(raw) {
        if (!check) return { ok: true, args: raw };
        const r = check.safeParse(raw);
        if (r.success) return { ok: true, args: r.data as Record<string, unknown> };
        return onlyRefs(r.error, raw)
          ? { ok: true, args: raw }
          : { ok: false, error: invalidArguments(t.name, r.error) };
      },
      check(args, ctx) {
        const refs = fileRefs(args);
        if (!refs.length) return;
        if (!deps.files) throw new Error("files cannot be passed to MCP tools here");
        const open = deps.files(ctx.thread);
        for (const ref of refs) open(ref);
      },
      title: () => `${d.name}: ${label}`,
      async run(given, ctx) {
        let args = given;
        if (hasFileRefs(given)) {
          if (!deps.files) throw new Error("files cannot be passed to MCP tools here");
          args = fillFileArgs(given, t.inputSchema, { remote: Boolean(d.url), open: deps.files(ctx.thread) });
          const filled = check?.safeParse(args);
          if (filled && !filled.success) throw new Error(invalidArguments(t.name, filled.error));
        }
        const r = await invoke(d, t, args, ctx.signal, ctx.thread.project_id);
        const text =
          (r.content ?? [])
            .map((p) => (p.type === "text" ? (p.text ?? "") : `[${p.type}]`))
            .join("\n")
            .trim() || (r.structuredContent ? JSON.stringify(r.structuredContent) : "(no output)");
        const body = untrusted("mcp_result", { server: d.name, tool: t.name }, cap(text));
        if (r.isError) throw new Error(body);
        return body;
      },
    };
  }

  const idle = setInterval(() => {
    for (const [key, c] of conns)
      if (Date.now() - c.used > IDLE_MS) {
        void closeConn(c);
        conns.delete(key);
      }
  }, 60_000);
  idle.unref();

  /** A subproject also reaches its parent's own servers, under its own of the same name. */
  const projectDefs = (projectId: string): McpDef[] => {
    const own = config.project(projectId);
    const parent = parentOf(deps.store.projects, projectId);
    const taken = new Set(own.map((d) => d.name));
    return [...own, ...(parent ? config.project(parent.id).filter((d) => !taken.has(d.name)) : [])];
  };
  const defsFor = (projectId: string | undefined) => {
    const off = projectId ? new Set(config.offIn(projectId)) : new Set<string>();
    return [
      ...config
        .global()
        .filter((d) => !off.has(d.name) && (!d.only || d.only === projectId))
        .map((d) => inProject(d, projectId)),
      ...(projectId ? projectDefs(projectId) : []),
    ];
  };

  return {
    config,
    /** The servers a turn in this thread may reach, by name, without starting any. */
    serversFor(thread: Thread): string[] {
      return [
        ...new Set(
          defsFor(thread.project_id)
            .filter((d) => d.enabled && config.trusted(d))
            .map((d) => d.name),
        ),
      ];
    },
    /** The MCP tools a turn in this thread may use: enabled, approved servers of its project and the owner's. */
    async toolsFor(thread: Thread): Promise<Tool[]> {
      const defs = defsFor(thread.project_id).filter((d) => d.enabled && config.trusted(d));
      const live = defs.map((d) => ({ d, c: ensure(d) }));
      await Promise.allSettled(live.map(({ c }) => c.ready));
      // Names are unique per turn: a clash after sanitizing gets a short suffix; the owner's servers come first.
      const taken = new Set<string>();
      const out: Tool[] = [];
      for (const { d, c } of live) {
        if (c.status !== "ready") continue;
        for (const t of c.tools) {
          if (t.name === d.monitorTool) continue;
          let name = toolName(d.name, t.name);
          if (taken.has(name))
            name = `${name.slice(0, 57)}_${createHash("sha256").update(`${d.scope}:${d.name}:${t.name}`).digest("hex").slice(0, 6)}`;
          if (taken.has(name)) continue;
          taken.add(name);
          out.push(adapt(d, t, name));
        }
      }
      return out;
    },
    async toolPermissions(d: McpDef) {
      if (!d.enabled || !config.trusted(d)) throw badRequest("approve and enable this server before listing tools");
      const c = ensure(d);
      await c.ready;
      if (!c.client) throw unavailable(c.error ?? "MCP server is not connected");
      const current = this.find(d.scope, d.name, d.values_of ?? d.project_id ?? d.only);
      if (!current || current.hash !== d.hash || !current.enabled || !config.trusted(current))
        throw conflict("MCP server definition changed");
      return c.tools
        .filter((t) => t.name !== d.monitorTool)
        .map((t) => ({
          ...mcpApproval(d, t),
          name: t.name,
          approved: deps.store.approvals.allows(mcpApproval(d, t)),
        }));
    },
    /** Whether every tool of the server is allowed, those it adds later included, or which ones ("some"). */
    toolMode(d: McpDef): "ask" | "all" | "some" {
      const mode = permissionMode(d, seen(d) ?? []);
      return mode === "unknown" ? "ask" : mode;
    },
    /**
     * "all": every tool, new ones included, for every agent (one grant for the server). "ask": none; the server's
     * grant and each tool's own for every agent go (one agent's or one chat's stay).
     */
    setToolMode: (d: McpDef, mode: "ask" | "all") => setMcpToolMode(deps.store, d, mode),
    /** Who let every agent use all its tools, under this definition or the one before an edit; none: undefined. */
    allowsAll: (d: Pick<McpDef, "scope" | "project_id" | "name">) => allowsAll(deps.store, d),
    /**
     * A server new to the owner lets agents use every tool; the owner blocks what they want (DECISIONS.md#d-279).
     * `again`: open it even if it was opened before (added anew after its removal).
     */
    openNew: (d: McpDef, again = false, by?: OpenedBy) => openNew(deps.store, d, again, by),
    /** A removed server is new again if it comes back (as the owner's allowed one, with `by` "owner"). */
    forgetOpened: (d: Pick<McpDef, "scope" | "project_id" | "name">, by?: OpenedBy) => forgetOpened(deps.store, d, by),
    async describe(d: McpDef, project?: string) {
      const context = project ?? d.values_of ?? d.project_id ?? d.only;
      const eligible = defsFor(context).find((x) => keyOf(x) === keyOf(d));
      if (!eligible?.enabled || !config.trusted(eligible))
        throw new Error("MCP server is not enabled and approved in this context");
      await this.toolPermissions(d);
      const c = ensure(d);
      return c.tools;
    },
    async observe(d: McpDef, args: Record<string, unknown>) {
      if (!d.monitorTool) throw new Error("MCP server has no managed observation tool");
      return this.call(d, d.monitorTool, args, undefined, true);
    },
    async call(d: McpDef, name: string, args: Record<string, unknown>, project?: string, observation = false) {
      if (name === d.monitorTool && !observation) throw new Error("This tool is reserved for managed observations");
      const tools = await this.describe(d, project);
      const t = tools.find((t) => t.name === name);
      if (!t) throw new Error(`MCP tool ${name} not found`);
      const parsed = adapt(d, t, name).parse(args);
      if (!parsed.ok) throw new Error(parsed.error);
      return invoke(d, t, parsed.args, AbortSignal.timeout(CALL_MS), project ?? d.values_of ?? d.project_id ?? d.only);
    },
    references(projectId?: string) {
      return defsFor(projectId).map((d) => ({
        id: serverApprovalId(d),
        name: d.name,
        hash: d.hash,
        active: d.enabled && config.trusted(d),
        projects: valuesIn(d.values_of),
        variables: secretNames(d),
      }));
    },
    status(projectId?: string): McpStatus[] {
      const defs = [
        ...config
          .global()
          .filter((d) => !projectId || !d.only || d.only === projectId)
          .map((d) => inProject(d, projectId ?? d.only)),
        // A subproject lists its parent's servers too: their project_id says they are the parent's.
        ...(projectId ? projectDefs(projectId) : deps.store.projects.list().flatMap((p) => config.project(p.id))),
      ];
      const offHere = new Set(projectId ? config.offIn(projectId) : []);
      const offIn = deps.store.projects.list().map((p) => ({ id: p.id, off: new Set(config.offIn(p.id)) }));
      return defs.map((d) => {
        const c = conns.get(keyOf(d));
        const trusted = config.trusted(d);
        const live = c && c.hash === d.hash ? c : undefined;
        // Not running now: what it listed last time, so the list tells its tools and permissions before a click.
        const known = live?.tools.length
          ? live.tools.map((t) => ({ name: t.name, key: mcpApproval(d, t).key }))
          : (seen(d) ?? []);
        return {
          name: d.name,
          scope: d.scope,
          ...(d.project_id || d.only ? { project_id: d.project_id ?? d.only } : {}),
          only: Boolean(d.only),
          transport: d.url ? "http" : "stdio",
          target: (d.url ?? [d.command, ...d.args].join(" ")).replace(
            /\{\{apx-literal-\d+\}\}/g,
            (token) => d.literalSettings?.[token] ?? token,
          ),
          enabled: d.enabled,
          trusted,
          status: !d.enabled
            ? "disabled"
            : !trusted
              ? "needs-approval"
              : (live?.status ?? (waitsSignIn(d) ? "needs-sign-in" : "off")),
          ...(live?.signInUrl ? { sign_in_url: live.signInUrl } : {}),
          tools: known.length,
          tool_names: known.map((t) => t.name),
          tool_permission_mode: permissionMode(d, known),
          vars: secretNames(d).map((name) => ({
            name,
            set: deps.secrets.resolveIn(`secret://${name}`, valuesIn(projectId ?? d.only)) !== undefined,
          })),
          off_here: d.scope === "global" && offHere.has(d.name),
          off_in: d.scope === "global" && !d.only ? offIn.filter((p) => p.off.has(d.name)).map((p) => p.id) : [],
          ...(d.own || d.scope === "project"
            ? {
                definition: {
                  ...(d.command ? { command: d.command } : {}),
                  args: d.args,
                  env: d.env,
                  ...(d.url ? { url: d.url } : {}),
                  headers: d.headers,
                },
              }
            : {}),
          ...(live?.error ? { error: live.error } : {}),
        };
      });
    },
    /**
     * Starts a separate copy of a server and waits for its tools; the connection agents use is left alone. Only a
     * definition the owner approved runs: a project's file is someone else's command until then.
     */
    async test(d: McpDef): Promise<{ ok: boolean; ms: number; tools: string[]; error?: string }> {
      if (!config.trusted(d)) return { ok: false, ms: 0, tools: [], error: "approve this server before testing it" };
      if (blocked.has(blockKey(d)))
        return { ok: false, ms: 0, tools: [], error: "This server is being updated; try again shortly" };
      const live = conns.get(keyOf(d));
      if ((live?.hash === d.hash && live.status === "needs-sign-in") || waitsSignIn(d))
        return { ok: false, ms: 0, tools: [], error: SIGN_IN_FIRST };
      const t0 = Date.now();
      let asked!: (url: string) => void;
      const askedFor = new Promise<string>((r) => {
        asked = r;
      });
      const ac = new AbortController();
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const key = keyOf(d);
      const active = tests.get(key) ?? new Set();
      const run = { abort: () => ac.abort(), done };
      active.add(run);
      tests.set(key, active);
      const started = connect(d, (url) => asked(url), ac.signal);
      try {
        const first = await Promise.race([started, askedFor]);
        if (typeof first === "string") {
          if (blocked.has(blockKey(d))) {
            ac.abort();
            await started.then(
              ({ client }) => client.close(),
              () => {},
            );
            throw conflict("This server is being updated; try again shortly");
          }
          // The copy becomes the connection agents use: the sign-in the owner finishes is the one they get.
          const key = keyOf(d);
          const old = conns.get(key);
          if (old) void closeConn(old);
          const c: Conn = { key, hash: d.hash, tools: [], status: "starting", used: Date.now() };
          conns.set(key, c);
          follow(
            d,
            c,
            (onSignIn) => {
              onSignIn(first);
              return started;
            },
            () => ac.abort(),
          );
          return { ok: false, ms: Date.now() - t0, tools: [], error: SIGN_IN_ASKED };
        }
        const { client, tools } = first;
        await client.close().catch(() => {});
        remember(d, tools);
        // A server that failed earlier is worth starting again for agents now that it answers.
        const live = conns.get(keyOf(d));
        if (live?.status === "error") conns.delete(keyOf(d));
        return { ok: true, ms: Date.now() - t0, tools: tools.map((t) => t.name) };
      } catch (err) {
        return { ok: false, ms: Date.now() - t0, tools: [], error: errorMessage(err) };
      } finally {
        active.delete(run);
        if (!active.size) tests.delete(key);
        finish();
      }
    },
    /**
     * The owner signs a server in: it starts now as the connection agents use, and the answer comes once it is ready,
     * failed, or waits on the page it opened (`sign_in_url` in its status).
     */
    async signIn(d: McpDef): Promise<void> {
      if (!d.enabled || !config.trusted(d)) throw badRequest("approve and enable this server before signing in");
      if (blocked.has(blockKey(d))) throw conflict("This server is being updated; try again shortly");
      const old = conns.get(keyOf(d));
      conns.delete(keyOf(d));
      if (old) await closeConn(old);
      setWaitsSignIn(d, false);
      await ensure(d).ready;
    },
    /** The last `n` lines a server printed on stderr while this core ran (started by an agent or a test). */
    logs(d: McpDef, n: number) {
      return stderr.read(keyOf(d), n);
    },
    /** Refuses new starts while an extension replaces the servers' files. */
    suspend(servers: Array<Pick<McpDef, "scope" | "project_id" | "name">>): () => void {
      const keys = [...new Set(servers.map(blockKey))];
      if (keys.some((key) => blocked.has(key))) throw conflict("This server is already being updated");
      for (const key of keys) blocked.add(key);
      return () => {
        for (const key of keys) blocked.delete(key);
      };
    },
    /** Closes a server's connection now (approval withdrawn, definition removed). */
    async drop(d: Pick<McpDef, "scope" | "project_id" | "name">, preserveApprovals = false): Promise<void> {
      if (!preserveApprovals) deps.store.approvals.revokeServer(serverApprovalId(d));
      const prefix = `${d.scope}:${d.project_id ?? ""}:`;
      const mine = (key: string) => key.startsWith(prefix) && key.endsWith(`:${d.name}`);
      for (const [key, c] of conns) {
        if (mine(key)) {
          conns.delete(key);
          void closeConn(c);
        }
      }
      const pending: Promise<void>[] = [];
      for (const [c, done] of closing) if (mine(c.key)) pending.push(done);
      for (const [key, active] of tests) {
        if (!mine(key)) continue;
        for (const run of active) {
          run.abort();
          pending.push(run.done);
        }
      }
      stderr.forget(mine);
      if (!preserveApprovals) forget(mine);
      await waitForExit(Promise.all(pending), "MCP connection did not close; try again");
      await processes.wait(mine);
    },
    /** A global server as it runs in `projectId` (or in its own project, when it is limited to one). */
    find(scope: "global" | "project", name: string, projectId?: string): McpDef | undefined {
      if (scope === "project") return projectId ? config.project(projectId).find((d) => d.name === name) : undefined;
      const d = config.global().find((x) => x.name === name);
      return d && inProject(d, projectId ?? d.only);
    },
    async close(): Promise<void> {
      clearInterval(idle);
      await Promise.allSettled([...conns.values()].map(closeConn));
      conns.clear();
    },
  };
}

export type Mcp = ReturnType<typeof createMcp>;
