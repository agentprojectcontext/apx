// Connections to MCP servers, opened when an agent's turn needs them and closed when idle, and their tools as APX
// tools: same argument check, same policy, results marked as outside data.

import { createHash } from "node:crypto";
import type { Thread } from "@apx/protocol";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, errorMessage, unavailable } from "../errors.ts";
import { commandEnv } from "../harness/env.ts";
import type { Log } from "../log.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";
import { cap, untrusted } from "../tools/result.ts";
import { type Confirm, type Effect, invalidArguments, type Tool } from "../tools/types.ts";
import { type McpTool, mcpApproval, serverApprovalId } from "./approval.ts";
import { type McpDef, mcpConfig } from "./config.ts";

const CONNECT_MS = 20_000;
const CALL_MS = 120_000;
const IDLE_MS = 10 * 60_000;

type Conn = {
  key: string;
  hash: string;
  client?: Client;
  tools: McpTool[];
  status: "starting" | "ready" | "error";
  error?: string;
  used: number;
  failedAt?: number;
  ready?: Promise<void>;
};

/** A server that failed is tried again only after this, not on every turn. */
const RETRY_MS = 5 * 60_000;

export type McpStatus = {
  name: string;
  scope: "global" | "project";
  project_id?: string;
  only: boolean;
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
  trusted: boolean;
  status: "off" | "needs-approval" | "disabled" | "starting" | "ready" | "error";
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

export function createMcp(deps: { store: Store; secrets: Secrets; log: Log }) {
  const config = mcpConfig(deps.store);
  const conns = new Map<string, Conn>();
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

  /** Starts a server and lists its tools, within CONNECT_MS. The caller owns the client and closes it. */
  async function connect(d: McpDef): Promise<{ client: Client; tools: McpTool[] }> {
    // Loaded with the first server: a core with none never loads the MCP client.
    const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    ]);
    const client = new Client({ name: "apx", version: "2" });
    const transport = d.url
      ? new StreamableHTTPClientTransport(new URL(d.url), {
          requestInit: { headers: resolve(d.headers, d.values_of) },
        })
      : new StdioClientTransport({
          command: d.command ?? "",
          args: d.args.map((a) => resolveText(a, d.values_of)),
          // Only what the definition gives it, on top of an environment without credentials.
          env: { ...commandEnv(), ...resolve(d.env, d.values_of) },
          ...(d.cwd ? { cwd: d.cwd } : {}),
          stderr: "ignore",
        });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer in ${CONNECT_MS / 1000}s`)), CONNECT_MS);
        }),
      ]);
      const { tools } = await client.listTools(undefined, { timeout: CONNECT_MS });
      return { client, tools: tools as McpTool[] };
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function open(d: McpDef, c: Conn): Promise<void> {
    try {
      const { client, tools } = await connect(d);
      // Replaced or dropped while starting: this process is nobody's now.
      if (conns.get(c.key) !== c) {
        await client.close().catch(() => {});
        return;
      }
      c.client = client;
      c.tools = tools;
      c.status = "ready";
    } catch (err) {
      c.status = "error";
      c.failedAt = Date.now();
      c.error = errorMessage(err);
      deps.log.warn({ mcp: d.name, err: c.error }, "MCP server did not start");
    }
  }

  /** The live connection for a definition, (re)opened when missing, failed or its definition changed. */
  function ensure(d: McpDef): Conn {
    const key = keyOf(d);
    let c = conns.get(key);
    if (c && c.hash !== d.hash) {
      void c.client?.close().catch(() => {});
      c = undefined;
    }
    if (!c || (c.status === "error" && Date.now() - (c.failedAt ?? 0) > RETRY_MS)) {
      c = { key, hash: d.hash, tools: [], status: "starting", used: Date.now() };
      conns.set(key, c);
      c.ready = open(d, c);
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
    if (!c.client) throw new Error(`${d.name} is not connected${c.error ? `: ${c.error}` : ""}`);
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
      confirm: () => confirm,
      deadlineMs: CALL_MS + 5_000,
      parse(raw) {
        if (!check) return { ok: true, args: raw };
        const r = check.safeParse(raw);
        return r.success
          ? { ok: true, args: r.data as Record<string, unknown> }
          : { ok: false, error: invalidArguments(t.name, r.error) };
      },
      title: () => `${d.name}: ${label}`,
      async run(args, ctx) {
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
        void c.client?.close().catch(() => {});
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
          status: !d.enabled ? "disabled" : !trusted ? "needs-approval" : (live?.status ?? "off"),
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
      const t0 = Date.now();
      try {
        const { client, tools } = await connect(d);
        await client.close().catch(() => {});
        // A server that failed earlier is worth starting again for agents now that it answers.
        const live = conns.get(keyOf(d));
        if (live?.status === "error") conns.delete(keyOf(d));
        return { ok: true, ms: Date.now() - t0, tools: tools.map((t) => t.name) };
      } catch (err) {
        return { ok: false, ms: Date.now() - t0, tools: [], error: errorMessage(err) };
      }
    },
    /** Closes a server's connection now (approval withdrawn, definition removed). */
    drop(d: Pick<McpDef, "scope" | "project_id" | "name">): void {
      deps.store.approvals.revokeServer(serverApprovalId(d));
      for (const [key, c] of conns) {
        const prefix = `${d.scope}:${d.project_id ?? ""}:`;
        if (key.startsWith(prefix) && key.endsWith(`:${d.name}`)) {
          void c.client?.close().catch(() => {});
          conns.delete(key);
        }
      }
    },
    /** A global server as it runs in `projectId` (or in its own project, when it is limited to one). */
    find(scope: "global" | "project", name: string, projectId?: string): McpDef | undefined {
      if (scope === "project") return projectId ? config.project(projectId).find((d) => d.name === name) : undefined;
      const d = config.global().find((x) => x.name === name);
      return d && inProject(d, projectId ?? d.only);
    },
    async close(): Promise<void> {
      clearInterval(idle);
      await Promise.allSettled([...conns.values()].map((c) => c.client?.close()));
      conns.clear();
    },
  };
}

export type Mcp = ReturnType<typeof createMcp>;
