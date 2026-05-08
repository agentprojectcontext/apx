import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export async function cmdMcpList(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const mcps = await http.get(`/projects/${pid}/mcps`);
  if (mcps.length === 0) {
    console.log("(no MCPs registered for this project)");
    return;
  }
  console.log("NAME".padEnd(24) + " EN " + "SOURCE".padEnd(8) + " TRANSPORT  COMMAND/URL");
  for (const m of mcps) {
    const target = m.transport === "http"
      ? m.url
      : (m.command || "") + (m.args?.length ? " " + m.args.join(" ") : "");
    console.log(
      m.name.padEnd(24) + " " +
      (m.enabled ? "✓" : "✗").padEnd(2) + " " +
      (m.source || "apc").padEnd(8) + " " +
      (m.transport || "stdio").padEnd(10) + " " +
      target
    );
  }
}

export async function cmdMcpAdd(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp add: missing <name>");
  const command = args.flags.command;
  if (!command || command === true) throw new Error("apx mcp add: --command required");

  // Args after `--` go to the MCP. `args._` already excludes the `--` separator
  // when our parser strips it. We treat anything in args._ after [0] as args.
  const mcpArgs = args._.slice(1);

  const env = {};
  if (args.flags.env) {
    const entries = Array.isArray(args.flags.env) ? args.flags.env : [args.flags.env];
    for (const e of entries) {
      const [k, ...rest] = String(e).split("=");
      env[k] = rest.join("=");
    }
  }

  const pid = await resolveProjectId(args?.flags?.project);
  const result = await http.post(`/projects/${pid}/mcps`, {
    name,
    command,
    args: mcpArgs,
    env,
    enabled: true,
  });
  console.log(`Added MCP "${result.name}"`);
}

export async function cmdMcpRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp remove: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/mcps/${name}`);
  console.log(`Removed MCP "${name}"`);
}

export async function cmdMcpEnable(args) {
  await toggleEnabled(args, true);
}
export async function cmdMcpDisable(args) {
  await toggleEnabled(args, false);
}

async function toggleEnabled(args, enabled) {
  const name = args._[0];
  if (!name) throw new Error(`apx mcp ${enabled ? "enable" : "disable"}: missing <name>`);
  const pid = await resolveProjectId(args?.flags?.project);
  const all = await http.get(`/projects/${pid}/mcps`);
  const m = all.find((x) => x.name === name);
  if (!m) throw new Error(`MCP "${name}" not registered`);
  await http.post(`/projects/${pid}/mcps`, {
    name: m.name,
    command: m.command,
    args: m.args,
    env: m.env,
    enabled,
  });
  console.log(`${enabled ? "Enabled" : "Disabled"} MCP "${name}"`);
}

export async function cmdMcpRun(args) {
  const name = args._[0];
  const tool = args._[1];
  if (!name || !tool) throw new Error("apx mcp run: usage: apx mcp run <name> <tool> [<json-args>]");
  let params = {};
  if (args._[2]) {
    try {
      params = JSON.parse(args._[2]);
    } catch (e) {
      throw new Error(`invalid JSON args: ${e.message}`);
    }
  }
  const pid = await resolveProjectId(args?.flags?.project);
  const result = await http.post(`/projects/${pid}/mcps/${name}/call`, { tool, params });
  process.stdout.write(JSON.stringify(result.result, null, 2) + "\n");
}

export async function cmdMcpTools(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp tools: missing <name>");
  // Daemon doesn't have a dedicated tools/list endpoint yet; we'd extend it in v0.2.
  // For now, print a hint:
  console.log(`(apx mcp tools — list of tools/list will arrive in v0.2)`);
  console.log(`To call a tool: apx mcp run ${name} <tool> '<json>'`);
}

export async function cmdMcpCheck(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const data = await http.get(`/projects/${pid}/mcps/check`);

  console.log("Source files:");
  for (const s of data.sources) {
    console.log(`  ${s.present ? "✓" : "·"} ${s.id.padEnd(8)} ${s.file}`);
  }
  console.log("");

  if (data.entries.length === 0) {
    console.log("(no MCPs in any source)");
  } else {
    console.log("Active entries (after merge):");
    console.log("  " + "NAME".padEnd(24) + " SOURCE   TRANSPORT  EN");
    for (const m of data.entries) {
      console.log(
        "  " + m.name.padEnd(24) + " " +
        (m.source || "apc").padEnd(8) + " " +
        (m.transport || "stdio").padEnd(10) + " " +
        (m.enabled ? "✓" : "✗")
      );
    }
  }

  if (data.conflicts && data.conflicts.length) {
    console.log("\n⚠️  Conflicts (APC rule: first source wins):");
    for (const c of data.conflicts) {
      console.log(`  ${c.name}: kept "${c.winner}", ignored "${c.loser}"`);
    }
  } else {
    console.log("\n✓ no conflicts");
  }
}
