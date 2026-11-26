// apx_settings' MCP servers: which ones the owner has, what each tool may do, and changing that at the owner's word.
// A new server allows every tool; the owner, or the super-agent for them, makes the ones they want ask first
// (DECISIONS.md#d-279, over D-268's "already added").
import { mcpServerApproval } from "../mcp/approval.ts";
import type { Setting, SettingsDeps } from "./settings-kit.ts";
import { str } from "./settings-kit.ts";
import { ownServers, shownValue } from "./settings-work.ts";

type Seen = { hash: string; tools: Array<{ name: string; key: string }> };

/** One server as it listed its tools last (`mcp_tools_seen`): the params that reach it, and what each tool may do. */
function permissionLine(key: string, seen: Seen, { store }: SettingsDeps): string {
  const [scope = "global", project = "", valuesOf = "", ...rest] = key.split(":");
  const name = rest.join(":");
  const server = mcpServerApproval({
    scope: scope === "project" ? "project" : "global",
    project_id: project || undefined,
    values_of: valuesOf || undefined,
    name,
    hash: seen.hash,
  });
  const all = store.approvals.allows(server);
  const allowed = seen.tools.filter(
    (t) => all || store.approvals.allows({ key: t.key, server: server.server, tool: t.name, permanent: false }),
  );
  const asking = seen.tools.filter((t) => !allowed.includes(t));
  const where = project ? `, project ${project}` : valuesOf ? ` (with project ${valuesOf}'s values)` : "";
  const state = all
    ? "every tool allowed, new ones too"
    : !allowed.length
      ? "every tool asks first"
      : `allowed: ${allowed.map((t) => t.name).join(", ")}; new ones ask first`;
  const asks = !all && allowed.length && asking.length ? `; asks first: ${asking.map((t) => t.name).join(", ")}` : "";
  const tools = all || !allowed.length ? ` — ${seen.tools.map((t) => t.name).join(", ") || "no tools"}` : "";
  return `- ${name} (scope ${scope}${where}): ${state}${asks}${tools}`;
}

export const MCP: Readonly<Record<string, Setting>> = {
  "mcp.list": {
    does: "the MCP servers: the owner's own (command or URL, the variables they name as secret://NAME, on or off) and what each server's tools may do, as each listed them last",
    read: (_p, deps) => {
      const own =
        Object.entries(ownServers(deps.store))
          .map(([name, r]) => {
            const vars = Object.entries({ ...r.env, ...r.headers }).map(([k, v]) => `${k}=${shownValue(String(v))}`);
            const target = r.url ?? [r.command, ...(r.args ?? [])].join(" ");
            return `- ${name}: ${target}${vars.length ? `; ${vars.join(", ")}` : ""}${r.enabled === false ? " (off)" : ""}`;
          })
          .join("\n") || "no MCP servers of the owner's own yet.";
      const seen = Object.entries(deps.store.settings.read("mcp_tools_seen"));
      const tools = seen.length
        ? seen.map(([key, s]) => permissionLine(key, s, deps)).join("\n")
        : "no server has listed its tools yet: one shows here once it has run.";
      return `${own}\n\nTools (change with mcp.toolMode):\n${tools}`;
    },
  },
  "mcp.approveTool": {
    does: "let agents run one tool of an MCP server without asking each time (scope global or project, server, project, tool)",
    named: ["scope", "server", "project", "tool"],
    says: (p) => `Let agents run ${str(p.tool)} of the MCP server ${str(p.server)} without asking`,
  },
  "mcp.toolMode": {
    does: "what an MCP server's tools may do (scope, server, project, mode). all: every tool, new ones too; all with ask: [tools]: those ask first and the rest are allowed; ask: every tool asks first",
    named: ["scope", "server", "project", "mode"],
    says: (p) => {
      const ask = Array.isArray(p.ask) ? p.ask.map(String) : [];
      if (p.mode !== "all") return `Make agents ask before each tool of the MCP server ${str(p.server)}`;
      return ask.length
        ? `Let agents run the tools of the MCP server ${str(p.server)} without asking, except ${ask.join(", ")}`
        : `Let agents run every tool of the MCP server ${str(p.server)} without asking`;
    },
    refuse: (p) =>
      p.mode !== "all" && Array.isArray(p.ask) && p.ask.length
        ? "ask lists the tools that ask first while the rest are allowed: give it with mode all"
        : undefined,
  },
  "mcp.trust": {
    does: "approve a project's MCP server from its .apx/mcps.json so it runs (project, server, trusted), or stop it (trusted false)",
    named: ["project", "server", "trusted"],
    says: (p) =>
      p.trusted
        ? `Run the MCP server ${str(p.server)} from the project's file`
        : `Stop the MCP server ${str(p.server)}`,
    // Running a new command on this computer is adding a server: the owner's card (DECISIONS.md#d-267).
    asks: (p) => (p.trusted ? "card" : undefined),
  },
};
