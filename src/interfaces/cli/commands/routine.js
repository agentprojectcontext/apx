import fs from "node:fs";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { listRoutines } from "#core/stores/routines.js";
import { projectStorageRoot } from "#core/config/index.js";
import {
  routineMemoryPath,
  readRoutineMemory,
  appendRoutineMemory,
  ensureRoutineMemory,
} from "#core/stores/routine-memory.js";

function parseSpec(args) {
  // Build spec from --spec '<json>' or from --K=V pairs
  if (args.flags.spec && args.flags.spec !== true) {
    try {
      return JSON.parse(args.flags.spec);
    } catch (e) {
      throw new Error(`--spec is not valid JSON: ${e.message}`);
    }
  }
  const spec = {};
  for (const [k, v] of Object.entries(args.flags)) {
    if (["name", "kind", "schedule", "spec", "verbose", "permission-mode", "allowed-tools"].includes(k)) continue;
    if (v === true) continue;
    // try to JSON-parse the value (numbers, bools), else keep as string
    let val = v;
    try { val = JSON.parse(v); } catch {}
    spec[k] = val;
  }
  return spec;
}

export async function cmdRoutineList(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const rows = await http.get(`/projects/${pid}/routines`);
  if (rows.length === 0) {
    console.log(`(no routines in project #${pid})`);
    return;
  }
  // Show project ID in header so user knows which project's routines are displayed.
  console.log(`project #${pid} routines:`);
  console.log("NAME".padEnd(22) + " EN " + "KIND".padEnd(11) + " SCHEDULE".padEnd(20) + " NEXT_RUN".padEnd(22) + " LAST");
  for (const r of rows) {
    console.log(
      r.name.padEnd(22) + " " +
      (r.enabled ? "✓" : "✗").padEnd(2) + " " +
      (r.kind || "?").padEnd(10) + " " +
      (r.schedule || "?").padEnd(20) + " " +
      (r.next_run_at || "—").padEnd(22) + " " +
      (r.last_status === "ok" ? "✓ " : r.last_status === "error" ? "✗ " : "  ") +
      (r.last_run_at || "—")
    );
  }
}

export async function cmdRoutineGet(args) {
  const name = args._[0];
  if (!name) throw new Error("apx routine get: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.get(`/projects/${pid}/routines/${name}`);
  console.log(JSON.stringify(r, null, 2));
}

export async function cmdRoutineAdd(args) {
  const name = args._[0];
  if (!name) throw new Error("apx routine add: missing <name>");
  const kind = args.flags.kind === true ? null : args.flags.kind;
  const schedule = args.flags.schedule === true ? null : args.flags.schedule;
  if (!kind || !schedule)
    throw new Error("apx routine add: --kind and --schedule are required");
  const spec = parseSpec(args);
  const permission_mode = args.flags["permission-mode"] && args.flags["permission-mode"] !== true
    ? args.flags["permission-mode"]
    : undefined;
  const allowed_tools = args.flags["allowed-tools"] && args.flags["allowed-tools"] !== true
    ? String(args.flags["allowed-tools"]).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  // Pipeline: pre/post commands as comma-separated list or repeated --pre-commands flags.
  const parseCmdList = (val) => {
    if (!val || val === true) return undefined;
    if (Array.isArray(val)) return val.flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean);
    return String(val).split(",").map((s) => s.trim()).filter(Boolean);
  };
  const pre_commands = parseCmdList(args.flags["pre-commands"]);
  const post_commands = parseCmdList(args.flags["post-commands"]);
  const skip_prompt_on = args.flags["skip-prompt-on"] && args.flags["skip-prompt-on"] !== true
    ? args.flags["skip-prompt-on"]
    : undefined;
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.post(`/projects/${pid}/routines`, { name, kind, schedule, spec, permission_mode, allowed_tools, pre_commands, post_commands, skip_prompt_on });
  console.log(`added routine "${r.name}" (${r.kind}, ${r.schedule}) → next ${r.next_run_at}`);
  if (r.pre_commands?.length)  console.log(`  pre:  ${r.pre_commands.join(", ")}`);
  if (r.post_commands?.length) console.log(`  post: ${r.post_commands.join(", ")}`);
  if (r.skip_prompt_on && r.skip_prompt_on !== "signal") console.log(`  skip_prompt_on: ${r.skip_prompt_on}`);
}

export async function cmdRoutineRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx routine remove: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/routines/${name}`);
  console.log(`removed routine "${name}"`);
}

export async function cmdRoutineEnable(args) {
  await toggle(args, true);
}

export async function cmdRoutineDisable(args) {
  await toggle(args, false);
}

async function toggle(args, enabled) {
  const name = args._[0];
  if (!name) throw new Error(`apx routine ${enabled ? "enable" : "disable"}: missing <name>`);
  const pid = await resolveProjectId(args?.flags?.project);
  await http.post(
    `/projects/${pid}/routines/${name}/${enabled ? "enable" : "disable"}`
  );
  console.log(`${enabled ? "enabled" : "disabled"} routine "${name}"`);
}

export async function cmdRoutineRun(args) {
  const name = args._[0];
  if (!name) throw new Error("apx routine run: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.post(`/projects/${pid}/routines/${name}/run`);
  console.log(JSON.stringify(r, null, 2));
}

// Resolve a routine by name OR id to its { id, name, storagePath } so the
// memory subcommand accepts either argument transparently.
async function resolveRoutineRef(pid, refRaw) {
  const ref = String(refRaw || "").trim();
  if (!ref) throw new Error("missing <name|id>");
  const projects = await http.get("/projects");
  const project = projects.find((p) => String(p.id) === String(pid));
  if (!project) throw new Error(`project #${pid} not found`);
  const storagePath = project.storage_path || projectStorageRoot(project.apx_id);
  const routines = listRoutines(storagePath);
  const match = routines.find((r) => r.id === ref || r.name === ref);
  if (!match) throw new Error(`routine "${ref}" not found in project #${pid}`);
  return { id: match.id, name: match.name, storagePath };
}

export async function cmdRoutineMemory(args) {
  const sub = args._[0];
  const ref = args._[1];
  const pid = await resolveProjectId(args?.flags?.project);

  if (!sub || (sub !== "show" && sub !== "add" && sub !== "path")) {
    throw new Error("usage: apx routine memory <show|add|path> <name|id> [note]");
  }

  const { id, name, storagePath } = await resolveRoutineRef(pid, ref);
  const file = routineMemoryPath(storagePath, id);

  if (sub === "path") {
    console.log(file);
    return;
  }
  if (sub === "show") {
    ensureRoutineMemory(storagePath, id, name);
    const body = readRoutineMemory(storagePath, id);
    if (!body.trim()) {
      console.log(`(empty — ${file})`);
      return;
    }
    process.stdout.write(body);
    if (!body.endsWith("\n")) console.log("");
    return;
  }
  // add
  const note = args._.slice(2).join(" ").trim();
  if (!note) throw new Error("apx routine memory add: missing <note>");
  const result = appendRoutineMemory(storagePath, id, note, { routineName: name });
  console.log(`appended to ${result.path}`);
}

export async function cmdRoutineHistory(args) {
  const name = args._[0];
  if (!name) throw new Error("apx routine history: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const limit = args.flags.n || args.flags.last || "50";
  const rows = await http.get(`/projects/${pid}/messages?channel=routine&limit=${encodeURIComponent(limit)}`);
  const filtered = rows
    .filter((r) => r.meta?.routine === name)
    .reverse();
  if (filtered.length === 0) {
    console.log("(no routine history)");
    return;
  }
  for (const r of filtered) {
    const status = r.meta?.status ? ` ${r.meta.status}` : "";
    console.log(`${r.ts}${status} ${r.author || ""}: ${r.body}`);
  }
}
