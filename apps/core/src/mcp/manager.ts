// Connections to MCP servers, opened when an agent's turn needs them and closed when idle, and their tools as APX
// tools: same argument check, same policy, results marked as outside data.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Thread } from "@apx/protocol";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, errorMessage, unavailable } from "../errors.ts";
import { commandEnv, SECRET_NAME } from "../harness/env.ts";
import type { Log } from "../log.ts";
import { onPath } from "../programs.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";
import { cap, untrusted } from "../tools/result.ts";
import { type Confirm, type Effect, invalidArguments, type ScopedThread, type Tool } from "../tools/types.ts";
import { type McpTool, mcpApproval, serverApprovalId } from "./approval.ts";
import { ARGS_SECRET, type McpDef, mcpConfig } from "./config.ts";
import { fileRefs, fillFileArgs, hasFileRefs, type OpenFile, refOf } from "./file-args.ts";
import { createStderrLogs } from "./logs.ts";
import { watchSignIn } from "./sign-in.ts";

const CONNECT_MS = 20_000;
const CALL_MS = 120_000;
const IDLE_MS = 10 * 60_000;
/** How long a server that asked the owner to sign in is kept running, so the browser's answer still finds it. */
const SIGN_IN_MS = 5 * 60_000;

type Conn = {
  key: string;
  hash: string;
  client?: Client;
  tools: McpTool[];
  status: "starting" | "ready" | "error" | "needs-sign-in";
  error?: string;
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
  error?: string;
};

/** A stored secret named in a value, whole or inside text. */
const SECRET_REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;

/** The stored secrets a definition names, in order, once each. */
const secretNames = (d: McpDef): string[] => [
  ...new Set(
    [...Object.values(d.env), ...Object.values(d.headers), ...d.args, d.url ?? ""].flatMap((v) =>
      [...v.matchAll(SECRET_REF)].map((m) => m[1] as string),
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
  const stderr = createStderrLogs();
  const keyOf = (d: McpDef) => `${d.scope}:${d.project_id ?? ""}:${d.values_of ?? ""}:${d.name}`;

  /**
   * `secret://NAME` is resolved here, at start, and never written anywhere else: a whole value, or inside text
   * ("Bearer secret://API_KEY"). A name with no value stays as written.
   */
  const resolveText = (v: string, valuesOf?: string) =>
    deps.secrets.resolveIn(v, valuesOf) ?? v.replace(SECRET_REF, (ref) => deps.secrets.resolveIn(ref, valuesOf) ?? ref);
  const resolve = (values: Record<string, string>, valuesOf?: string) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, resolveText(v, valuesOf)]));
  /** An owner's server in a project with its own value for one of its variables runs as a copy of its own there. */
  const inProject = (d: McpDef, projectId: string | undefined): McpDef =>
    projectId && secretNames(d).some((n) => deps.secrets.has(`secret://${projectSecretName(projectId, n)}`))
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
  async function connect(
    d: McpDef,
    onSignIn?: (url: string) => void,
    signal?: AbortSignal,
  ): Promise<{ client: Client; tools: McpTool[] }> {
    if (d.args.some((a) => a.includes("secret://"))) throw new Error(ARGS_SECRET);
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
    const arm = (ms: number, why: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(why)), ms);
    };
    let transport: InstanceType<typeof StreamableHTTPClientTransport> | InstanceType<typeof StdioClientTransport>;
    if (d.url)
      transport = new StreamableHTTPClientTransport(new URL(d.url), {
        requestInit: { headers: resolve(d.headers, d.values_of) },
      });
    else {
      const env = resolve(d.env, d.values_of);
      // Windows starts it through cmd, which hides a missing program as a closed connection: say so first.
      const cmd = d.command ?? "";
      if (process.platform === "win32" && !/[\\/]/.test(cmd) && !onPath(cmd)) throw new Error(`spawn ${cmd} ENOENT`);
      const stdio = new StdioClientTransport({
        command: d.command ?? "",
        args: d.args.map((a) => resolveText(a, d.values_of)),
        // Only what the definition gives it, on top of an environment without credentials.
        env: { ...commandEnv(), ...env },
        cwd: d.cwd ?? ownDir(d.name),
        stderr: "pipe",
      });
      // A server may print what it was given: its secrets and credential-like variables are masked in its log.
      const hidden = [
        ...secretNames(d).map((n) => deps.secrets.resolveIn(`secret://${n}`, d.values_of) ?? ""),
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
    try {
      arm(CONNECT_MS, `no answer in ${CONNECT_MS / 1000}s`);
      // Our deadline ends the start, not the SDK's own minute: a sign-in may take longer.
      await Promise.race([client.connect(transport, { timeout: SIGN_IN_MS }), deadline]);
      const { tools } = await client.listTools(undefined, { timeout: CONNECT_MS });
      return { client, tools: tools as McpTool[] };
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

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
    start: (onSignIn: (url: string) => void) => Promise<{ client: Client; tools: McpTool[] }>,
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
    c.stop = async () => {
      abort();
      await started.catch(() => {});
    };
    started
      .then(
        async ({ client, tools }) => {
          // Replaced or dropped while starting: this process is nobody's now.
          if (!mine()) return void (await client.close().catch(() => {}));
          c.client = client;
          c.tools = tools;
          c.status = "ready";
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
  }

  /** Closes a connection, or the start still opening it. */
  async function closeConn(c: Conn): Promise<void> {
    await c.stop?.();
    await c.client?.close().catch(() => {});
  }

  /** The live connection for a definition, (re)opened when missing, failed or its definition changed. */
  function ensure(d: McpDef): Conn {
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
    return (await c.client.callTool({ name: t.name, arguments: args }, undefined, {
      timeout: CALL_MS,
      signal: signal,
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
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

  const defsFor = (projectId: string | undefined) => {
    const off = projectId ? new Set(config.offIn(projectId)) : new Set<string>();
    return [
      ...config
        .global()
        .filter((d) => !off.has(d.name) && (!d.only || d.only === projectId))
        .map((d) => inProject(d, projectId)),
      ...(projectId ? config.project(projectId) : []),
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
      return c.tools.map((t) => ({
        ...mcpApproval(d, t),
        name: t.name,
        approved: deps.store.approvals.allows(mcpApproval(d, t)),
      }));
    },
    async describe(d: McpDef, project?: string) {
      const context = project ?? d.values_of ?? d.project_id ?? d.only;
      const eligible = defsFor(context).find((x) => keyOf(x) === keyOf(d));
      if (!eligible?.enabled || !config.trusted(eligible))
        throw new Error("MCP server is not enabled and approved in this context");
      await this.toolPermissions(d);
      const c = ensure(d);
      return c.tools;
    },
    async call(d: McpDef, name: string, args: Record<string, unknown>, project?: string) {
      const tools = await this.describe(d, project);
      const t = tools.find((t) => t.name === name);
      if (!t) throw new Error(`MCP tool ${name} not found`);
      const parsed = adapt(d, t, name).parse(args);
      if (!parsed.ok) throw new Error(parsed.error);
      return invoke(d, t, parsed.args, AbortSignal.timeout(CALL_MS), project ?? d.values_of ?? d.project_id ?? d.only);
    },
    status(projectId?: string): McpStatus[] {
      const projects = projectId ? [projectId] : deps.store.projects.list().map((p) => p.id);
      const defs = [
        ...config
          .global()
          .filter((d) => !projectId || !d.only || d.only === projectId)
          .map((d) => inProject(d, projectId ?? d.only)),
        ...projects.flatMap((p) => config.project(p)),
      ];
      const offHere = new Set(projectId ? config.offIn(projectId) : []);
      return defs.map((d) => {
        const c = conns.get(keyOf(d));
        const trusted = config.trusted(d);
        const live = c && c.hash === d.hash ? c : undefined;
        const known = live?.tools ?? [];
        const allowed = known.filter((t) => deps.store.approvals.allows(mcpApproval(d, t))).length;
        return {
          name: d.name,
          scope: d.scope,
          ...(d.project_id || d.only ? { project_id: d.project_id ?? d.only } : {}),
          only: Boolean(d.only),
          transport: d.url ? "http" : "stdio",
          target: d.url ?? [d.command, ...d.args].join(" "),
          enabled: d.enabled,
          trusted,
          status: !d.enabled
            ? "disabled"
            : !trusted
              ? "needs-approval"
              : (live?.status ?? (waitsSignIn(d) ? "needs-sign-in" : "off")),
          ...(live?.signInUrl ? { sign_in_url: live.signInUrl } : {}),
          tools: live?.tools.length ?? 0,
          tool_names: live?.tools.map((t) => t.name) ?? [],
          tool_permission_mode: !known.length
            ? "unknown"
            : !allowed
              ? "ask"
              : allowed === known.length
                ? "all"
                : "some",
          vars: secretNames(d).map((name) => ({
            name,
            set: deps.secrets.resolveIn(`secret://${name}`, projectId ?? d.only) !== undefined,
          })),
          off_here: d.scope === "global" && offHere.has(d.name),
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
      const live = conns.get(keyOf(d));
      if ((live?.hash === d.hash && live.status === "needs-sign-in") || waitsSignIn(d))
        return { ok: false, ms: 0, tools: [], error: SIGN_IN_FIRST };
      const t0 = Date.now();
      let asked!: (url: string) => void;
      const askedFor = new Promise<string>((r) => {
        asked = r;
      });
      const ac = new AbortController();
      const started = connect(d, (url) => asked(url), ac.signal);
      try {
        const first = await Promise.race([started, askedFor]);
        if (typeof first === "string") {
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
        // A server that failed earlier is worth starting again for agents now that it answers.
        const live = conns.get(keyOf(d));
        if (live?.status === "error") conns.delete(keyOf(d));
        return { ok: true, ms: Date.now() - t0, tools: tools.map((t) => t.name) };
      } catch (err) {
        return { ok: false, ms: Date.now() - t0, tools: [], error: errorMessage(err) };
      }
    },
    /**
     * The owner signs a server in: it starts now as the connection agents use, and the answer comes once it is ready,
     * failed, or waits on the page it opened (`sign_in_url` in its status).
     */
    async signIn(d: McpDef): Promise<void> {
      if (!d.enabled || !config.trusted(d)) throw badRequest("approve and enable this server before signing in");
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
    /** Closes a server's connection now (approval withdrawn, definition removed). */
    drop(d: Pick<McpDef, "scope" | "project_id" | "name">): void {
      deps.store.approvals.revokeServer(serverApprovalId(d));
      const prefix = `${d.scope}:${d.project_id ?? ""}:`;
      const mine = (key: string) => key.startsWith(prefix) && key.endsWith(`:${d.name}`);
      for (const [key, c] of conns) {
        if (mine(key)) {
          void closeConn(c);
          conns.delete(key);
        }
      }
      stderr.forget(mine);
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
