// Tools a turn does not send reach the model through two tools instead of one schema each: an MCP server's tools can
// weigh more than the whole prompt, and the list a turn sends stays the same whatever servers start. See
// DECISIONS.md#d-053 and #d-234
import { z } from "zod";
import { cap } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export const TOOL_SEARCH = "tool_search";
export const TOOL_RUN = "tool_run";

/** Results a search returns at most; each carries its full argument schema. */
const MAX_RESULTS = 8;
const SCHEMA_CAP = 2_000;

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/**
 * Apps the owner connects (Gmail, Calendar…) whose tools are found like an MCP server's instead of sent on every call:
 * most turns use none of them (DECISIONS.md#d-229). By the tool name's first word.
 */
const APPS: Record<string, string> = { calendar: "calendar", gmail: "gmail", drive: "drive", asana: "asana" };
export const appOf = (name: string): string | undefined => APPS[name.split("_")[0] ?? ""];

/**
 * APX's own tools that under 1% of the super-agent's turns used over a month, by what they are for: named in
 * tool_search's description and called by name like a found tool, instead of a schema on every call
 * (DECISIONS.md#d-233, #d-234).
 */
const OWN_GROUPS: Record<string, string[]> = {
  Routines: ["routine_list", "routine_set"],
  "Settings and team": ["apx_settings", "apx_flow", "agent_set", "agent_limits", "grant_tool", "voice_replies"],
  "Owner and attention": ["notify_owner", "attention_hours", "suggest_connection", "commitment_settle"],
  "Tasks and memory": ["task_tidy", "forget"],
  "Coding sessions": ["list_sessions", "start_session", "stop_session"],
  "Documents and widgets": ["open_document", "show_widget", "edit_widget", "read_widget"],
  Media: ["make_image", "video_transcript"],
  "Screen of this computer": ["screen_open", "screen_do", "screen_snapshot"],
  Browser: ["browser_evaluate", "browser_handoff", "browser_sign_in"],
  Contacts: ["contact_list", "contact_requests", "answer_contact_request"],
};
export const OWN_FOUND: ReadonlySet<string> = new Set(Object.values(OWN_GROUPS).flat());

/** A tool a turn reaches through the bridge rather than in its list: a connected app's, or one of APX's rarely used. */
export const foundLater = (name: string): boolean => Boolean(appOf(name)) || OWN_FOUND.has(name);

/** The server a tool belongs to, from its "[server] …" description, the app it works on, or APX for its own. */
const serverOf = (t: Tool) =>
  /^\[([^\]]+)\]/.exec(t.description)?.[1] ?? appOf(t.name) ?? (OWN_FOUND.has(t.name) ? "apx" : "");

/** Best first: words in the tool's name count double. */
function rank(tools: Tool[], query: string): Tool[] {
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

/** Exact names asked for: `names`, or a query written "select:a,b" as some models do. */
function namesOf(a: { names?: string[] | undefined; query?: string | undefined }): string[] {
  const picked = /^\s*select:(.*)$/i.exec(a.query ?? "")?.[1];
  return [...(a.names ?? []), ...(picked ? picked.split(/[\s,]+/) : [])].map((n) => n.trim()).filter(Boolean);
}

const described = (t: Tool) =>
  `## ${t.name}\n${t.description}\nargs: ${JSON.stringify(t.parameters).slice(0, SCHEMA_CAP)}`;

/**
 * The two tools that stand for every tool a turn does not send. The description names APX's own by what they are for
 * and the apps and servers it may reach, so the model knows what exists without loading anything; `load` starts the
 * servers on first use. tool_run never runs here: the executor turns it into a call of the tool it names, with that
 * tool's own checks.
 */
export function mcpBridge(
  servers: string[],
  load: () => Promise<Tool[]>,
  apps: string[] = [],
  own: string[] = [],
): Tool[] {
  const mine = new Set(own);
  const groups = Object.entries(OWN_GROUPS)
    .map(([use, names]) => [use, names.filter((n) => mine.has(n))] as const)
    .filter(([, names]) => names.length)
    .map(([use, names]) => `${use}: ${names.join(", ")}`)
    .join("; ");
  const where = [
    apps.length ? `the owner's connected apps (${apps.join(", ")})` : "",
    servers.length ? `MCP servers (${servers.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const sources = [...apps, ...servers, ...(own.length ? ["apx"] : [])];
  return [
    defineTool({
      name: TOOL_SEARCH,
      description: [
        groups ? `APX tools not loaded yet, by use. ${groups}.` : "",
        where ? `${groups ? "Also the" : "The"} tools of ${where}.` : "",
        "Give names to get those tools' arguments, or words to find one. Then call it by its name like any tool.",
        servers.length
          ? "To open a server's editor from chat, link apx:resources/mcp/NAME (apx-mcps explains scopes)."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      args: z.object({
        names: z.array(z.string().max(64)).max(10).optional().describe("exact tool names to load"),
        query: z.string().max(200).optional().describe("words for what you want to do"),
        server: z.string().max(64).optional().describe("only this server or app; alone, lists all its tools"),
      }),
      effect: "none",
      deadlineMs: 45_000,
      title: (a) => {
        const names = namesOf(a);
        return `Searched tools${names.length ? `: ${names.join(", ")}` : a.query ? `: ${a.query}` : a.server ? ` of ${a.server}` : ""}`;
      },
      async run(a) {
        const all = await load();
        const names = namesOf(a);
        if (names.length) {
          const byName = new Map(all.map((t) => [t.name, t]));
          const missing = names.filter((n) => !byName.has(n));
          const found = names.flatMap((n) => byName.get(n) ?? []).map(described);
          if (missing.length)
            found.push(
              `not among the tools to load: ${missing.join(", ")}; one you already have, call directly; else search by words`,
            );
          return cap(found.join("\n\n"));
        }
        const pool = a.server ? all.filter((t) => serverOf(t) === a.server) : all;
        if (!pool.length)
          return a.server
            ? `no tools from ${a.server} (not started, or not one of: ${sources.join(", ")})`
            : "no tool server answered";
        if (!a.query)
          return cap(pool.map((t) => `- ${t.name}: ${t.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n"));
        const found = rank(pool, a.query).slice(0, MAX_RESULTS);
        if (!found.length)
          return `nothing matches "${a.query}"; search other words, list a server's tools, or, for an app not connected, suggest_connection`;
        return cap(found.map(described).join("\n\n"));
      },
    }),
    defineTool({
      name: TOOL_RUN,
      description: `Run a tool ${TOOL_SEARCH} found, when calling it by name does not work: its exact name and its arguments.${servers.length ? " To pass a file to an MCP tool, give the value apx-file:<path> or a med_ id of this chat: APX sends it as that field takes it (base64, or a path to a local server)." : ""}`,
      args: z.object({
        tool: z.string().min(1).max(64).describe(`the tool's name as ${TOOL_SEARCH} gave it`),
        args: z.record(z.string(), z.unknown()).optional().describe("its arguments, as its schema says"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Ran ${a.tool ?? "a tool"}`,
      async run() {
        throw new Error(`${TOOL_RUN} is resolved before it runs`);
      },
    }),
  ];
}

/** tool_run's arguments as the call of the tool it names (args may come as JSON text). */
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
