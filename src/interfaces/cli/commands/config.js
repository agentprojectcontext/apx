// `apx config` — read and edit configuration at either layer.
//
// APX has two config layers and this command reaches both:
//   default            the PROJECT layer, `.apc/config.json` (committed)
//   --global           the GLOBAL layer, `~/.apx/config.json` (machine-local)
//
// The global branch goes through the daemon's `/api/admin/config` route rather
// than calling writeConfig() here. That route writes the file AND hot-reloads
// the daemon's in-memory copy, re-registers log masking for any secret just
// stored, and refreshes the scheduler/plugin views. Writing the file directly
// would leave every one of those stale until the next restart.
//
// Scope vocabulary matches `apx obsidian` (project|global), not the MCP one
// (shared|runtime|global) — see the scope row in AGENTS.md's glossary.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { readConfig, writeConfig, CONFIG_PATH } from "#core/config/index.js";
import { DEFAULT_PERMISSION_MODE } from "#core/constants/permissions.js";

function parseValue(raw) {
  // best-effort: try JSON first (covers numbers, bools, objects, arrays, null,
  // and quoted strings). If that fails, treat as a literal string.
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// `--global` (boolean) or `--scope global|project`. Anything else is a typo
// worth failing on rather than silently treating as project scope — writing a
// global key like engines.*.api_key into a committed .apc/config.json is the
// exact accident this flag exists to prevent.
export function isGlobalScope(flags = {}) {
  if (flags.global) return true;
  if (flags.scope === undefined || flags.scope === null || flags.scope === "") return false;
  const s = String(flags.scope).toLowerCase();
  if (s === "global" || s === "default") return true;
  if (s === "project") return false;
  throw new Error(`unknown --scope "${flags.scope}" (use project|global)`);
}

// --effective and --only-overrides both name the project↔global merge, which
// does not exist when the global file *is* the whole story.
function rejectMergeFlags(flags, cmd) {
  const bad = ["effective", "only-overrides"].filter((f) => flags[f]);
  if (bad.length) {
    throw new Error(
      `apx ${cmd}: --${bad[0]} describes the project/global merge and does not apply to --global; ` +
        `drop --global to inspect a project, or drop --${bad[0]} to print ${CONFIG_PATH}`
    );
  }
}

async function showGlobal(args) {
  rejectMergeFlags(args.flags, "config show");
  const { config } = await http.get("/api/admin/config");
  // Header goes to stderr so `apx config show --global | jq .` still gets clean
  // JSON on stdout. Secrets arrive redacted from the route — rule 3 forbids
  // captured output carrying a real key.
  process.stderr.write(
    `# ${CONFIG_PATH} (global — secrets redacted)\n` +
      `# project overrides: apx config show (inside a project)\n\n`
  );
  process.stdout.write(JSON.stringify(config, null, 2) + "\n");
}

export async function cmdConfigShow(args) {
  if (isGlobalScope(args.flags)) return showGlobal(args);
  const pid = await resolveProjectId(args?.flags?.project);
  const data = await http.get(`/api/projects/${pid}/config`);
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
    throw new Error('apx config set: usage: apx config set [--global] <key.path> <value>');
  }
  const value = parseValue(valueRaw);
  // Name the layer in the confirmation: the whole point of the flag is that
  // "set" alone used to leave people guessing which file they just edited.
  if (isGlobalScope(args.flags)) {
    await http.patch("/api/admin/config", { set: { [key]: value } });
    console.log(`set ${key} = ${JSON.stringify(value)} (global: ${CONFIG_PATH})`);
    return;
  }
  const pid = await resolveProjectId(args?.flags?.project);
  await http.patch(`/api/projects/${pid}/config`, { set: { [key]: value } });
  console.log(`set ${key} = ${JSON.stringify(value)} (project: .apc/config.json)`);
}

export async function cmdConfigUnset(args) {
  const key = args._[0];
  if (!key) throw new Error("apx config unset: usage: apx config unset [--global] <key.path>");
  if (isGlobalScope(args.flags)) {
    await http.patch("/api/admin/config", { unset: [key] });
    console.log(`unset ${key} (global: ${CONFIG_PATH})`);
    return;
  }
  const pid = await resolveProjectId(args?.flags?.project);
  await http.patch(`/api/projects/${pid}/config`, { unset: [key] });
  console.log(`unset ${key} (project: .apc/config.json)`);
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
