import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

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
    console.log("(no routines)");
    return;
  }
  console.log("NAME".padEnd(20) + " EN " + "KIND".padEnd(11) + " SCHEDULE".padEnd(20) + " NEXT_RUN".padEnd(22) + " LAST");
  for (const r of rows) {
    console.log(
      r.name.padEnd(20) + " " +
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
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.post(`/projects/${pid}/routines`, { name, kind, schedule, spec, permission_mode, allowed_tools });
  console.log(`added routine "${r.name}" (${r.kind}, ${r.schedule}) → next ${r.next_run_at}`);
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
