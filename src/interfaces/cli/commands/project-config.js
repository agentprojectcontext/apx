// apx project config — wraps the daemon's per-project config endpoints
// (GET / PUT / PATCH /projects/:pid/config) with a friendly CLI surface.
//
//   apx project config show <project> [--key dotted.key] [--json]
//   apx project config set   <project> <dotted.key> <value>
//   apx project config unset <project> <dotted.key>
//   apx project config edit  <project>
//
// After any write we POST /admin/reload so the live daemon picks up the new
// model / channel routing / fallback order without a restart.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

async function reloadDaemon() {
  try {
    await http.post("/admin/reload", {});
  } catch (e) {
    console.log(`⚠️  reload failed: ${e.message} (changes saved, restart daemon to apply)`);
  }
}

// Read a dotted key from an arbitrary object. Returns undefined when any
// segment is missing or not an object.
function readDotted(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

// Best-effort JSON parse. Strings that don't parse stay as strings — that's
// what most users want when they type `apx project config set x.y 7` or
// `... set x.y true`.
function coerceValue(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  try {
    // Allow explicit JSON objects/arrays.
    if (raw.startsWith("{") || raw.startsWith("[") || raw.startsWith('"')) {
      return JSON.parse(raw);
    }
  } catch {
    // fall through — treat as string
  }
  return raw;
}

async function projectIdFromArg(target) {
  if (!target) throw new Error("missing <project> (name | id | path)");
  return await resolveProjectId(target);
}

export async function cmdProjectConfigShow(args) {
  const target = args._[0];
  const id = await projectIdFromArg(target);
  const data = await http.get(`/projects/${id}/config`);
  const key = args.flags.key;
  if (key) {
    const eff = readDotted(data.effective || {}, key);
    const only = readDotted(data.project_only || {}, key);
    if (args.flags.json) {
      console.log(JSON.stringify({ effective: eff, project_only: only }, null, 2));
    } else {
      console.log(`effective.${key}    = ${JSON.stringify(eff)}`);
      console.log(`project_only.${key} = ${JSON.stringify(only)}`);
    }
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export async function cmdProjectConfigSet(args) {
  const target = args._[0];
  const dotted = args._[1];
  const raw = args._[2];
  if (!dotted) throw new Error("apx project config set: missing <dotted.key>");
  if (raw === undefined) throw new Error("apx project config set: missing <value>");
  const id = await projectIdFromArg(target);
  const value = coerceValue(raw);
  await http.patch(`/projects/${id}/config`, { set: { [dotted]: value } });
  await reloadDaemon();
  console.log(`✅ set ${dotted} = ${JSON.stringify(value)}`);
}

export async function cmdProjectConfigUnset(args) {
  const target = args._[0];
  const dotted = args._[1];
  if (!dotted) throw new Error("apx project config unset: missing <dotted.key>");
  const id = await projectIdFromArg(target);
  await http.patch(`/projects/${id}/config`, { unset: [dotted] });
  await reloadDaemon();
  console.log(`✅ unset ${dotted}`);
}

export async function cmdProjectConfigEdit(args) {
  const target = args._[0];
  const id = await projectIdFromArg(target);
  const data = await http.get(`/projects/${id}/config`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-cfg-"));
  const tmpFile = path.join(tmpDir, "config.json");
  fs.writeFileSync(tmpFile, JSON.stringify(data.project_only || {}, null, 2) + "\n");
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
  if (result.status !== 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`editor exited with status ${result.status}`);
  }
  let updated;
  try {
    updated = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`invalid JSON after edit: ${e.message}`);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  await http.put(`/projects/${id}/config`, updated);
  await reloadDaemon();
  console.log(`✅ saved project_only config for #${id}`);
}
