import type { ApxClient } from "@apx/protocol/client";
import { clean } from "../presentation.ts";
import { mcps } from "./threads.ts";

const quote = (s: string) => `'${s.replaceAll("'", "'\"'\"'")}'`;

type Options = { project?: string | undefined; scope?: string | undefined; json?: boolean | undefined };

export async function mcpCommand(client: ApxClient, args: string[], o: Options): Promise<void> {
  const [sub, server, tool, raw] = args;
  if (sub !== "tools" && sub !== "run" && sub !== "check") {
    await mcps(client, args);
    return;
  }
  if (!server) throw new Error(`usage: apx mcp ${sub} <server> [<tool>] [--project <id>]`);
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
