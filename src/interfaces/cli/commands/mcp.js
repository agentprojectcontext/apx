import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { findApfRoot } from "#core/apc/parser.js";

const VALID_SCOPES = new Set(["shared", "runtime", "global", "all"]);

// Resolve --scope flag for add/remove (write ops). Default: shared when cwd is
// inside an APC project, else global.
function resolveWriteScope(flags) {
  if (flags?.scope) {
    const s = String(flags.scope).toLowerCase();
    if (s === "all") {
      throw new Error("--scope all is only valid for `list` and `check`");
    }
    if (!VALID_SCOPES.has(s)) {
      throw new Error(`unknown --scope "${flags.scope}" (use shared|runtime|global)`);
    }
    return s;
  }
  return findApfRoot() ? "shared" : "global";
}

// Resolve --scope flag for list (read op). Default: 'all'.
function resolveListScope(flags) {
  if (!flags?.scope) return "all";
  const s = String(flags.scope).toLowerCase();
  if (!VALID_SCOPES.has(s)) {
    throw new Error(`unknown --scope "${flags.scope}" (use shared|runtime|global|all)`);
  }
  return s;
}

// Source id (in entry.source) → user-facing scope
function sourceToScope(source) {
  if (source === "apc") return "shared";
  if (source === "runtime") return "runtime";
  if (source === "global") return "global";
  return source; // claude, cursor, vscode, roo, gemini — surfaced verbatim
}

export async function cmdMcpList(args = {}) {
  const scope = resolveListScope(args?.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  const mcps = await http.get(`/api/projects/${pid}/mcps`);
  const filtered = scope === "all"
    ? mcps
    : mcps.filter((m) => sourceToScope(m.source) === scope);

  if (filtered.length === 0) {
    if (scope === "all") {
      console.log("(no MCPs registered for this project)");
    } else {
      console.log(`(no MCPs in scope "${scope}" for this project)`);
    }
    return;
  }
  console.log("NAME".padEnd(24) + " EN " + "SOURCE".padEnd(8) + " TRANSPORT  COMMAND/URL");
  for (const m of filtered) {
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

// A flag that was given without a value parses as `true`. For value-carrying
// flags that means "the user typed --url with nothing after it" — not a value.
function flagValue(v) {
  return v === undefined || v === true ? null : String(v);
}

// `--header "Authorization: Bearer xxx"` and `--header X-Api-Key=abc` both work:
// we split on whichever of `:` / `=` comes first, so a value may contain either.
function parseHeaders(raw) {
  const headers = {};
  for (const h of Array.isArray(raw) ? raw : [raw]) {
    const s = String(h);
    const cuts = [s.indexOf(":"), s.indexOf("=")].filter((i) => i >= 0);
    if (cuts.length === 0) {
      throw new Error(`apx mcp add: bad --header "${s}" (use "Name: value" or Name=value)`);
    }
    const cut = Math.min(...cuts);
    const key = s.slice(0, cut).trim();
    if (!key) throw new Error(`apx mcp add: bad --header "${s}" (empty header name)`);
    headers[key] = s.slice(cut + 1).trim();
  }
  return headers;
}

function parseEnv(raw) {
  const env = {};
  for (const e of Array.isArray(raw) ? raw : [raw]) {
    const [k, ...rest] = String(e).split("=");
    env[k] = rest.join("=");
  }
  return env;
}

export async function cmdMcpAdd(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp add: missing <name>");

  const command = flagValue(args.flags.command);
  const url = flagValue(args.flags.url);

  // --transport is sugar; the real signal is --url (http) vs --command (stdio).
  // We only read it to reject a contradictory pair with a useful message.
  const declared = flagValue(args.flags.transport)?.toLowerCase() || null;
  if (declared && !["stdio", "http", "sse", "streamable-http"].includes(declared)) {
    throw new Error(`apx mcp add: unknown --transport "${declared}" (use stdio|http)`);
  }
  const transport = declared === "stdio" ? "stdio" : declared ? "http" : url ? "http" : "stdio";

  if (command && url) {
    throw new Error("apx mcp add: pass either --command (stdio) or --url (http), not both");
  }
  if (transport === "http" && !url) {
    throw new Error("apx mcp add: --transport http requires --url <endpoint>");
  }
  if (transport === "stdio" && !command) {
    throw new Error(
      "apx mcp add: --command required for a stdio server (for a remote one: --url <endpoint>)"
    );
  }
  if (args.flags.header && transport !== "http") {
    throw new Error("apx mcp add: --header only applies to an http server (--url)");
  }

  const scope = resolveWriteScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);

  let body;
  if (transport === "http") {
    body = {
      name,
      url,
      ...(args.flags.header ? { headers: parseHeaders(args.flags.header) } : {}),
      enabled: true,
    };
  } else {
    // Args after `--` go to the MCP. `args._` already excludes the `--` separator
    // when our parser strips it. We treat anything in args._ after [0] as args.
    body = {
      name,
      command,
      args: args._.slice(1),
      env: args.flags.env ? parseEnv(args.flags.env) : {},
      enabled: true,
    };
  }

  const result = await http.post(
    `/api/projects/${pid}/mcps?scope=${encodeURIComponent(scope)}`,
    body
  );
  console.log(`Added MCP "${result.name}" (${transport}, scope: ${scope})`);
}

export async function cmdMcpRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp remove: missing <name>");
  const scope = resolveWriteScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/api/projects/${pid}/mcps/${name}?scope=${encodeURIComponent(scope)}`);
  console.log(`Removed MCP "${name}" (scope: ${scope})`);
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
  const all = await http.get(`/api/projects/${pid}/mcps`);
  const m = all.find((x) => x.name === name);
  if (!m) throw new Error(`MCP "${name}" not registered`);
  // Write back to the scope it lives in so we don't accidentally shadow it.
  const scope = args?.flags?.scope
    ? resolveWriteScope(args.flags)
    : sourceToScope(m.source);
  if (!VALID_SCOPES.has(scope) || scope === "all") {
    throw new Error(
      `MCP "${name}" comes from foreign source "${m.source}" — toggle it in that IDE's config directly.`
    );
  }
  // Re-post only the keys that belong to this server's transport — sending
  // `command: null` at an http entry would write a stdio field into it.
  await http.post(`/api/projects/${pid}/mcps?scope=${encodeURIComponent(scope)}`, {
    name: m.name,
    ...(m.transport === "http"
      ? { url: m.url, headers: m.headers || {} }
      : { command: m.command, args: m.args, env: m.env }),
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
  const result = await http.post(`/api/projects/${pid}/mcps/${name}/call`, { tool, params });
  process.stdout.write(JSON.stringify(result.result, null, 2) + "\n");
}

// Turn a JSON-Schema type into a short placeholder for the run-example JSON.
function placeholderFor(schema) {
  const t = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;
  if (schema?.enum?.length) return schema.enum[0];
  if (t === "number" || t === "integer") return 0;
  if (t === "boolean") return false;
  if (t === "array") return [];
  if (t === "object") return {};
  return `<${t || "string"}>`;
}

function schemaTypeLabel(schema) {
  if (schema?.enum?.length) return schema.enum.join("|");
  const t = Array.isArray(schema?.type) ? schema.type.join("|") : schema?.type;
  return t || "any";
}

function firstLine(s) {
  return String(s || "").split("\n")[0].trim();
}

function printToolDetail(mcpName, tool) {
  console.log(`${mcpName} · ${tool.name}`);
  if (tool.description) console.log(`  ${tool.description.trim().replace(/\n/g, "\n  ")}`);

  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const keys = Object.keys(props);
  console.log("");
  if (keys.length === 0) {
    console.log("  Params: (none)");
  } else {
    console.log("  Params:");
    const nameW = Math.max(...keys.map((k) => k.length), 4) + 2;
    const typeW = Math.max(...keys.map((k) => schemaTypeLabel(props[k]).length), 4) + 2;
    for (const k of keys) {
      const req = required.has(k) ? "(required)" : "(optional)";
      console.log(
        `    ${k.padEnd(nameW)}${schemaTypeLabel(props[k]).padEnd(typeW)}${req}  ${firstLine(props[k]?.description)}`
      );
    }
  }

  // Example invocation with the required params stubbed in.
  const example = {};
  for (const k of keys) {
    if (required.has(k)) example[k] = placeholderFor(props[k]);
  }
  console.log("");
  console.log("  Run:");
  console.log(`    apx mcp run ${mcpName} ${tool.name} '${JSON.stringify(example)}'`);
}

export async function cmdMcpTools(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp tools: usage: apx mcp tools <name> [<tool>] [--json]");
  const toolFilter = args._[1];
  const pid = await resolveProjectId(args?.flags?.project);
  const data = await http.get(`/api/projects/${pid}/mcps/${name}/tools`);
  const tools = data.tools || [];

  if (toolFilter) {
    const tool = tools.find((t) => t.name === toolFilter);
    if (!tool) {
      const hint = tools.length
        ? `Available: ${tools.map((t) => t.name).join(", ")}`
        : "(server reported no tools)";
      throw new Error(`MCP "${name}" has no tool "${toolFilter}". ${hint}`);
    }
    if (args?.flags?.json) {
      process.stdout.write(JSON.stringify(tool, null, 2) + "\n");
      return;
    }
    printToolDetail(name, tool);
    return;
  }

  if (args?.flags?.json) {
    process.stdout.write(JSON.stringify(tools, null, 2) + "\n");
    return;
  }
  if (tools.length === 0) {
    console.log(`(MCP "${name}" reported no tools)`);
    return;
  }
  const nameW = Math.max(...tools.map((t) => t.name.length), 4) + 2;
  console.log(`${tools.length} tool${tools.length === 1 ? "" : "s"} — apx mcp tools ${name} <tool> for schema\n`);
  console.log("TOOL".padEnd(nameW) + " DESCRIPTION");
  for (const t of tools) {
    console.log(t.name.padEnd(nameW) + " " + firstLine(t.description).slice(0, 100));
  }
}

export async function cmdMcpLogs(args) {
  const name = args._[0];
  if (!name) throw new Error("apx mcp logs: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const logs = await http.get(`/api/projects/${pid}/mcps/${name}/logs`);
  if (args?.flags?.json) {
    process.stdout.write(JSON.stringify(logs, null, 2) + "\n");
    return;
  }
  const target = logs.transport === "http"
    ? logs.url
    : [logs.command, ...(logs.args || [])].filter(Boolean).join(" ");
  console.log(`${name} (${logs.transport})${target ? " — " + target : ""}`);
  if (logs.transport === "stdio") {
    console.log(`  running: ${logs.running ? "yes" : "no"}  started: ${logs.started_at || "-"}  last exit: ${logs.last_exit_code ?? "-"}`);
  } else {
    console.log(`  started: ${logs.started_at || "-"}  last error: ${logs.last_error || "-"}`);
  }
  if (logs.note) console.log(`  ${logs.note}`);
  if (logs.events?.length) {
    console.log("\nEvents:");
    for (const e of logs.events) {
      console.log(`  ${e.ts}  [${e.level}] ${e.msg}`);
    }
  }
  if (logs.stderr_tail?.trim()) {
    console.log("\nstderr tail:");
    for (const line of logs.stderr_tail.trim().split("\n")) {
      console.log(`  ${line}`);
    }
  }
}

export async function cmdMcpCheck(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const data = await http.get(`/api/projects/${pid}/mcps/check`);

  console.log("Source files:");
  for (const s of data.sources) {
    const marker = s.present ? "✓" : "·";
    const scope = s.scope ? `(${s.scope})`.padEnd(10) : "".padEnd(10);
    console.log(`  ${marker} ${s.id.padEnd(8)} ${scope} ${s.file}`);
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
    console.log("\n⚠️  Conflicts (priority: runtime > apc > IDE configs > global):");
    for (const c of data.conflicts) {
      console.log(`  ${c.name}: kept "${c.winner}", ignored "${c.loser}"`);
    }
  } else {
    console.log("\n✓ no conflicts");
  }
}
