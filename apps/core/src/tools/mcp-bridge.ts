// MCP tools reach the model through two tools instead of one schema each: a server's tools can weigh more than the
// whole prompt, and the list a turn sends stays the same whatever servers start. See DECISIONS.md#d-053
import { z } from "zod";
import { cap } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export const MCP_SEARCH = "mcp_search";
export const MCP_CALL = "mcp_call";

/** Results a search returns at most; each carries its full argument schema. */
const MAX_RESULTS = 8;
const SCHEMA_CAP = 2_000;

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/** The server a tool belongs to, from its "[server] …" description. */
const serverOf = (t: Tool) => /^\[([^\]]+)\]/.exec(t.description)?.[1] ?? "";

/** Best first: words in the tool's name count double. */
export function rank(tools: Tool[], query: string): Tool[] {
  const q = [...new Set(words(query))];
  if (!q.length) return tools;
  const scored = tools.map((t) => {
    const name = words(t.name.replace(/_/g, " "));
    const text = words(t.description);
    const score = q.reduce((n, w) => n + (name.some((x) => x.includes(w)) ? 2 : 0) + (text.includes(w) ? 1 : 0), 0);
    return { t, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.t);
}

/**
 * The two tools that stand for every MCP tool of a turn. `servers`: the names it may reach (they go in the
 * description, so the model knows what exists without loading anything). `load` starts the servers on first use.
 * mcp_call never runs here: the executor turns it into a call of the tool it names, with that tool's own checks.
 */
export function mcpBridge(servers: string[], load: () => Promise<Tool[]>): Tool[] {
  return [
    defineTool({
      name: MCP_SEARCH,
      description: `Find tools of the owner's MCP servers (${servers.join(", ")}) by words, or list one server's. Returns each tool's name, what it does and its arguments; run one with ${MCP_CALL}.`,
      args: z.object({
        query: z.string().max(200).optional().describe("words for what you want to do"),
        server: z.string().max(64).optional().describe("only this server; without a query, lists all its tools"),
      }),
      effect: "none",
      deadlineMs: 45_000,
      title: (a) => `Searched MCP tools${a.query ? `: ${a.query}` : a.server ? ` of ${a.server}` : ""}`,
      async run(a) {
        const all = await load();
        const pool = a.server ? all.filter((t) => serverOf(t) === a.server) : all;
        if (!pool.length)
          return a.server
            ? `no tools from ${a.server} (not started, or not one of: ${servers.join(", ")})`
            : "no MCP server answered";
        if (!a.query)
          return cap(pool.map((t) => `- ${t.name}: ${t.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n"));
        const found = rank(pool, a.query).slice(0, MAX_RESULTS);
        if (!found.length)
          return `nothing matches "${a.query}"; search other words, list a server's tools, or, for an app not connected, suggest_connection`;
        return cap(
          found
            .map((t) => `## ${t.name}\n${t.description}\nargs: ${JSON.stringify(t.parameters).slice(0, SCHEMA_CAP)}`)
            .join("\n\n"),
        );
      },
    }),
    defineTool({
      name: MCP_CALL,
      description: `Run an MCP tool found with ${MCP_SEARCH}: its exact name and its arguments. To pass a file, give the value apx-file:<path> or a med_ id of this chat: APX sends it as that field takes it (base64, or a path to a local server).`,
      args: z.object({
        tool: z.string().min(1).max(64).describe("the tool's name as mcp_search gave it (mcp_…)"),
        args: z.record(z.string(), z.unknown()).optional().describe("its arguments, as its schema says"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Ran ${a.tool ?? "an MCP tool"}`,
      async run() {
        throw new Error(`${MCP_CALL} is resolved before it runs`);
      },
    }),
  ];
}

/** mcp_call's arguments as the call of the tool it names (args may come as JSON text). */
export function unwrapCall(raw: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
  let args = raw.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {}
  }
  return {
    name: typeof raw.tool === "string" ? raw.tool : "",
    args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
  };
}
