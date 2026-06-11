import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { readConfig, writeConfig } from "#core/config/index.js";
import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from "#core/constants/permissions.js";

function parseValue(raw) {
  // best-effort: try JSON first (covers numbers, bools, objects, arrays, null,
  // and quoted strings). If that fails, treat as a literal string.
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function cmdConfigShow(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const data = await http.get(`/projects/${pid}/config`);
  if (args.flags.effective) {
    process.stdout.write(JSON.stringify(data.effective, null, 2) + "\n");
    return;
  }
  // `--only-overrides` shows just .apc/config.json contents.
  // (Was previously `--project` but that collided with the global --project
  // selector flag.)
  if (args.flags["only-overrides"]) {
    process.stdout.write(JSON.stringify(data.project_only, null, 2) + "\n");
    return;
  }
  console.log(`# .apc/config.json (project-only overrides)`);
  console.log(`# path: ${data.project_config_path}`);
  console.log("");
  console.log(JSON.stringify(data.project_only, null, 2));
  console.log("");
  console.log(`# effective (global merged with project)`);
  console.log("");
  console.log(JSON.stringify(data.effective, null, 2));
}

export async function cmdConfigSet(args) {
  const key = args._[0];
  const valueRaw = args._.slice(1).join(" ");
  if (!key || !valueRaw) {
    throw new Error('apx config set: usage: apx config set <key.path> <value>');
  }
  const pid = await resolveProjectId(args?.flags?.project);
  const value = parseValue(valueRaw);
  await http.patch(`/projects/${pid}/config`, { set: { [key]: value } });
  console.log(`set ${key} = ${JSON.stringify(value)}`);
}

export async function cmdConfigUnset(args) {
  const key = args._[0];
  if (!key) throw new Error("apx config unset: usage: apx config unset <key.path>");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.patch(`/projects/${pid}/config`, { unset: [key] });
  console.log(`unset ${key}`);
}

export function cmdPermission(args = {}) {
  const sub = args._[0] || "show";
  const cfg = readConfig();
  cfg.super_agent = cfg.super_agent || {};
  if (sub === "show" || sub === "get" || sub === "ls") {
    console.log(`permission_mode=${cfg.super_agent.permission_mode || DEFAULT_PERMISSION_MODE}`);
    console.log(`allowed_tools=${(cfg.super_agent.allowed_tools || []).join(",") || "(none)"}`);
    return;
  }
  if (sub === "set") {
    const mode = args._[1];
    if (!["total", "automatico", "permiso"].includes(mode)) {
      throw new Error("apx permissions set: mode must be total, automatico, or permiso");
    }
    cfg.super_agent.permission_mode = mode;
    writeConfig(cfg);
    console.log(`permission_mode=${mode}`);
    return;
  }
  throw new Error(`unknown permissions subcommand: ${sub}`);
}
