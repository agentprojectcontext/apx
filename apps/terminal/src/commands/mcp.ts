import type { ApxClient } from "@apx/protocol/client";
import { clean } from "../presentation.ts";
import { mcps } from "./threads.ts";

const quote = (s: string) => `'${s.replaceAll("'", "'\"'\"'")}'`;

type Options = {
  project?: string | undefined;
  scope?: string | undefined;
  json?: boolean | undefined;
  lines?: string | undefined;
  env?: string[] | undefined;
  header?: string[] | undefined;
};

export const MCPS_USAGE = `apx mcps [list [project]]                      MCP servers agents may use, and their state
apx mcps tools|run|check <server> …            Its tools, run one, or test that it starts (apx mcp tools …)
apx mcps signin <server> [--project p]         Sign in to one that asked for it (its page opens in your browser)
apx mcps logs <server> [--project p] [-n 100]  What it printed on stderr since the core started (secrets masked)
apx mcps trust|untrust <project> <server>      Approve a project's server as its .apc/mcps.json defines it
apx mcps on|off <server> --project p           Turn one of your servers on or off inside a project
apx mcps show <name> [--project p]             Its definition (secrets show as secret://NAME)
apx mcps add <name> [--env K=V…] -- <command…|url>   Add one of your own (--header K=V for a url)
apx mcps copy <from> <to> [--env K=V…]         A copy of one under a new name, with the variables you change
apx mcps set <name> --env K=V…                 Change variables (or --header) of one, keeping the rest
apx mcps rename <name> <new-name>              The same server under another name
apx mcps rm <name>                             Remove one of your own
  Live from the next message: nothing restarts. --project p works on that project's .apc/mcps.json instead.`;

export async function mcpCommand(client: ApxClient, args: string[], o: Options): Promise<void> {
  const [sub, server, tool, raw] = args;
  if (sub === "help") {
    console.log(MCPS_USAGE);
    return;
  }
  const lines = o.lines === undefined ? 100 : Number(o.lines);
  if (sub === "logs" && (!Number.isInteger(lines) || lines < 1 || lines > 300))
    throw new Error("-n is a number of lines, from 1 to 300");
  if (sub !== "tools" && sub !== "run" && sub !== "check" && sub !== "logs" && sub !== "signin") {
    await mcps(client, args, o);
    return;
  }
  if (!server)
    throw new Error(
      sub === "logs"
        ? "usage: apx mcps logs <server> [--project <id>] [-n 100]"
        : `usage: apx mcp ${sub} <server> [<tool>] [--project <id>]`,
    );
  const { servers } = await client.call("mcp.list", o.project ? { project: o.project } : {});
  const matches = servers.filter((s) => s.name === server && (!o.scope || s.scope === o.scope));
  const local = o.project ? matches.find((s) => s.scope === "project" && s.project_id === o.project) : undefined;
  const found = local ?? (matches.length === 1 ? matches[0] : undefined);
  if (!found)
    throw new Error(matches.length ? "Ambiguous server: use --project and --scope" : `MCP server ${server} not found`);
  const target = {
    scope: found.scope,
    server,
    ...(o.project ? { project: o.project } : found.scope === "project" ? { project: found.project_id } : {}),
  };
  if (sub === "logs") {
    const r = await client.call("mcp.logs", { ...target, lines });
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else for (const l of r.lines) console.log(`${new Date(l.at).toLocaleTimeString()}  ${clean(l.text)}`);
    if (!r.lines.length && !o.json)
      console.log(
        `(${clean(server)} printed nothing since the core started; it runs when an agent uses it or with apx mcp check)`,
      );
    return;
  }
  if (sub === "signin") {
    const { server: s } = await client.call("mcp.signIn", target);
    if (o.json) console.log(JSON.stringify(s, null, 2));
    else if (s.status === "ready") console.log(`${clean(server)}: signed in · ${s.tools} tools`);
    else if (s.sign_in_url)
      console.log(`${clean(server)}: finish signing in on the page it opened in your browser\n${s.sign_in_url}`);
    else console.log(`${clean(server)}: ${s.status}${s.error ? `\n${clean(s.error)}` : ""}`);
    if (s.status === "error") process.exitCode = 1;
    return;
  }
  if (sub === "check") {
    const r = await client.call("mcp.test", target);
    console.log(
      o.json
        ? JSON.stringify(r, null, 2)
        : `${server}: ${r.ok ? "OK" : "Failed"} · ${r.ms} ms · ${r.tools.length} tools${r.error ? `\n${r.error}` : ""}`,
    );
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (sub === "tools") {
    const r = await client.call("mcp.describe", target);
    const tools = tool ? r.tools.filter((t) => t.name === tool) : r.tools;
    if (tool && !tools.length) throw new Error(`MCP tool ${tool} not found`);
    if (o.json) console.log(JSON.stringify({ tools }, null, 2));
    else
      for (const t of tools) {
        console.log(
          `${clean(server)} · ${clean(t.name)}\n  ${clean(t.description ?? "")}\n  Schema: ${JSON.stringify(t.inputSchema)}\n  Run: apx mcp run ${quote(clean(server))} ${quote(clean(t.name))} '<json>'${target.project ? ` --project ${quote(target.project)}` : ""} --scope ${target.scope}`,
        );
      }
    return;
  }
  if (!tool) throw new Error("usage: apx mcp run <server> <tool> [<json>|-]");
  let input = raw ?? "{}";
  if (input === "-") {
    input = "";
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (input.length > 1_000_000) throw new Error("MCP arguments exceed 1 MB");
    }
  }
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("MCP arguments must be a JSON object");
  const r = await client.call("mcp.call", { ...target, tool, arguments: parsed as Record<string, unknown> });
  console.log(JSON.stringify(r, null, 2));
  if (r.isError) process.exitCode = 1;
}
