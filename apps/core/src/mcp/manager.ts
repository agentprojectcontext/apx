// Connections to MCP servers, opened when an agent's turn needs them and closed when idle, and their tools as APX
// tools: same argument check, same policy, results marked as outside data.

import { createHash } from "node:crypto";
import type { Thread } from "@apx/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import { commandEnv } from "../harness/env.ts";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import { cap, untrusted } from "../tools/result.ts";
import { type Confirm, type Effect, invalidArguments, type Tool } from "../tools/types.ts";
import { type McpDef, mcpConfig } from "./config.ts";

const CONNECT_MS = 20_000;
const CALL_MS = 120_000;
const IDLE_MS = 10 * 60_000;

type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
};

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
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
  trusted: boolean;
  status: "off" | "needs-approval" | "disabled" | "starting" | "ready" | "error";
  tools: number;
  tool_names: string[];
  vars: Array<{ name: string; set: boolean }>;
  off_here: boolean;
  error?: string;
};

/** The stored secrets a definition names, in order, once each. */
const secretNames = (d: McpDef): string[] => [
  ...new Set(
    [...Object.values(d.env), ...Object.values(d.headers), ...d.args, d.url ?? ""].flatMap((v) =>
      [...v.matchAll(/secret:\/\/([a-zA-Z0-9_.-]+)/g)].map((m) => m[1] as string),
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
  const keyOf = (d: McpDef) => `${d.scope}:${d.project_id ?? ""}:${d.name}`;

  /** `secret://` values are resolved here, at start, and never written anywhere else. */
  const resolve = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, deps.secrets.resolve(v) ?? v]));

  async function open(d: McpDef, c: Conn): Promise<void> {
    const client = new Client({ name: "apx", version: "2" });
    const transport = d.url
      ? new StreamableHTTPClientTransport(new URL(d.url), { requestInit: { headers: resolve(d.headers) } })
      : new StdioClientTransport({
          command: d.command ?? "",
          args: d.args,
          // Only what the definition gives it, on top of an environment without credentials.
          env: { ...commandEnv(), ...resolve(d.env) },
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
      // Replaced or dropped while starting: this process is nobody's now.
      if (conns.get(c.key) !== c) {
        await client.close().catch(() => {});
        return;
      }
      c.client = client;
      c.tools = tools as McpTool[];
      c.status = "ready";
    } catch (err) {
      c.status = "error";
      c.failedAt = Date.now();
      c.error = errorMessage(err);
      await client.close().catch(() => {});
      deps.log.warn({ mcp: d.name, err: c.error }, "MCP server did not start");
    } finally {
      clearTimeout(timer);
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

  function adapt(d: McpDef, t: McpTool, name: string): Tool {
    const ro = t.annotations?.readOnlyHint === true;
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
        // The connection may have been closed while the turn waited (an owner's long confirmation): reopen it.
        const c = ensure(d);
        await c.ready;
        if (!c.client) throw new Error(`${d.name} is not connected${c.error ? `: ${c.error}` : ""}`);
        const r = (await c.client.callTool({ name: t.name, arguments: args }, undefined, {
          timeout: CALL_MS,
          signal: ctx.signal,
        })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
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
    return [...config.global().filter((d) => !off.has(d.name)), ...(projectId ? config.project(projectId) : [])];
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
    status(projectId?: string): McpStatus[] {
      const projects = projectId ? [projectId] : deps.store.projects.list().map((p) => p.id);
      const defs = [...config.global(), ...projects.flatMap((p) => config.project(p))];
      const offHere = new Set(projectId ? config.offIn(projectId) : []);
      return defs.map((d) => {
        const c = conns.get(keyOf(d));
        const trusted = config.trusted(d);
        const live = c && c.hash === d.hash ? c : undefined;
        return {
          name: d.name,
          scope: d.scope,
          ...(d.project_id ? { project_id: d.project_id } : {}),
          transport: d.url ? "http" : "stdio",
          target: d.url ?? [d.command, ...d.args].join(" "),
          enabled: d.enabled,
          trusted,
          status: !d.enabled ? "disabled" : !trusted ? "needs-approval" : (live?.status ?? "off"),
          tools: live?.tools.length ?? 0,
          tool_names: live?.tools.map((t) => t.name) ?? [],
          vars: secretNames(d).map((name) => ({ name, set: deps.secrets.has(`secret://${name}`) })),
          off_here: d.scope === "global" && offHere.has(d.name),
          ...(live?.error ? { error: live.error } : {}),
        };
      });
    },
    /**
     * Starts a server afresh and waits for its tools. Only a definition the owner approved runs: a project's file is
     * someone else's command until then.
     */
    async test(d: McpDef): Promise<{ ok: boolean; ms: number; tools: string[]; error?: string }> {
      if (!config.trusted(d)) return { ok: false, ms: 0, tools: [], error: "approve this server before testing it" };
      const key = keyOf(d);
      void conns
        .get(key)
        ?.client?.close()
        .catch(() => {});
      conns.delete(key);
      const t0 = Date.now();
      const c = ensure(d);
      await c.ready;
      return {
        ok: c.status === "ready",
        ms: Date.now() - t0,
        tools: c.tools.map((t) => t.name),
        ...(c.error ? { error: c.error } : {}),
      };
    },
    /** Closes a server's connection now (approval withdrawn, definition removed). */
    drop(d: Pick<McpDef, "scope" | "project_id" | "name">): void {
      const key = keyOf(d as McpDef);
      void conns
        .get(key)
        ?.client?.close()
        .catch(() => {});
      conns.delete(key);
    },
    find(scope: "global" | "project", name: string, projectId?: string): McpDef | undefined {
      return (scope === "global" ? config.global() : projectId ? config.project(projectId) : []).find(
        (d) => d.name === name,
      );
    },
    async close(): Promise<void> {
      clearInterval(idle);
      await Promise.allSettled([...conns.values()].map((c) => c.client?.close()));
      conns.clear();
    },
  };
}

export type Mcp = ReturnType<typeof createMcp>;
