// apx profile — install, activate and configure the super-agent's personality.
//
//   apx profile list
//   apx profile show <id>       [--preview]
//   apx profile install <id|path> [--force]
//   apx profile use <id>        [--force]
//   apx profile off
//   apx profile config          [--set k=v]... [--interactive]
//   apx profile doctor          [<id>]
//   apx profile uninstall <id>
//
// Everything goes through the daemon: activating a profile changes the live
// system prompt and rewrites the routine schedule, so the process that owns
// both has to apply it. Writing config from here would leave the running
// daemon out of date.
import readline from "node:readline/promises";
import { http } from "../http.js";

export const PROFILE_USAGE = {
  list:      "apx profile list",
  show:      "apx profile show <id> [--preview]",
  install:   "apx profile install <id|path> [--force]",
  use:       "apx profile use <id> [--force]",
  off:       "apx profile off",
  config:    "apx profile config [--set key=value]... [--interactive]",
  doctor:    "apx profile doctor [<id>]",
  uninstall: "apx profile uninstall <id>",
};

function fail(sub, msg) {
  console.error(`apx profile ${sub}: ${msg}`);
  console.error(`Usage: ${PROFILE_USAGE[sub]}`);
  process.exit(1);
}

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** `--set k=v --set a=b` → { k: "v", a: "b" } */
function parseSetFlags(flags) {
  const out = {};
  for (const raw of asArray(flags?.set)) {
    const s = String(raw);
    const eq = s.indexOf("=");
    if (eq < 1) {
      console.error(`apx profile config: --set expects key=value — got "${s}"`);
      process.exit(1);
    }
    out[s.slice(0, eq).trim()] = s.slice(eq + 1);
  }
  return out;
}

function printWarnings(warnings = []) {
  for (const w of warnings) console.log(`  warning: ${w}`);
}

function printDoctor(report) {
  console.log(report.summary);
  if (report.tokens != null) {
    const budget = report.budget ? ` (declared budget ${report.budget})` : "";
    console.log(`  prompt: ~${report.tokens} tokens${budget}`);
  }
  for (const c of report.checks || []) {
    const mark = c.level === "error" ? "✖" : "!";
    console.log(`  ${mark} [${c.label}] ${c.detail}`);
    if (c.fix) console.log(`      fix: ${c.fix}`);
  }
}

// ── list ────────────────────────────────────────────────────────────────────

export async function cmdProfileList() {
  const { active, profiles } = await http.get("/api/profiles");
  if (!profiles.length) {
    console.log("(no profiles available)");
    return;
  }
  for (const p of profiles) {
    const mark = p.active ? "*" : " ";
    const version = p.version ? ` v${p.version}` : "";
    console.log(`${mark} ${p.id.padEnd(16)} ${p.name}${version}  [${p.source}]`);
    if (p.description) console.log(`    ${p.description}`);
  }
  console.log("");
  console.log(active ? `active: ${active}` : "active: none (vanilla)");
}

// ── show ────────────────────────────────────────────────────────────────────

export async function cmdProfileShow(args) {
  const id = args._[0];
  if (!id) fail("show", "missing <id>");

  const p = await http.get(`/api/profiles/${encodeURIComponent(id)}`);
  console.log(`${p.name} (${p.id}) v${p.version || "?"} — ${p.source}${p.active ? " — ACTIVE" : ""}`);
  if (p.description) console.log(p.description);
  console.log(`languages: ${p.languages.join(", ") || "en"}`);
  console.log(`prompt: ~${p.tokens} tokens${p.budget ? ` (declared budget ${p.budget})` : ""}`);
  console.log(`path: ${p.dir}`);

  const keys = Object.keys(p.config || {});
  if (keys.length) {
    console.log("\nsettings:");
    for (const k of keys.sort()) console.log(`  ${k.padEnd(24)} ${p.config[k]}`);
  }

  if (args?.flags?.preview) {
    console.log("\n--- rendered prompt block ---");
    console.log(p.preview || "(empty)");
  }
}

// ── install ─────────────────────────────────────────────────────────────────

export async function cmdProfileInstall(args) {
  const source = args._[0];
  if (!source) fail("install", "missing <id|path>");

  const r = await http.post("/api/profiles/install", { source, force: !!args?.flags?.force });
  console.log(`installed ${r.profile.name} (${r.profile.id}) v${r.profile.version || "?"}`);
  console.log(`  prompt: ~${r.tokens} tokens`);
  printWarnings(r.warnings);
  console.log("");
  console.log(`Not active yet — run: apx profile use ${r.profile.id}`);
}

// ── use / off ───────────────────────────────────────────────────────────────

export async function cmdProfileUse(args) {
  const id = args._[0];
  if (!id) fail("use", "missing <id>");

  const r = await http.post("/api/profiles/use", { id, force: !!args?.flags?.force });
  console.log(`active profile: ${r.profile.name} (${r.profile.id})`);
  printWarnings(r.warnings);

  const { installed = [], skipped = [] } = r.routines || {};
  if (installed.length) console.log(`  routines installed: ${installed.join(", ")}`);
  for (const s of skipped) {
    console.log(`  routine "${s.name}" left alone (${s.reason.replace(/_/g, " ")})`);
  }
  if (!r.profile.active) console.log("  (warning: profile did not activate)");
}

export async function cmdProfileOff() {
  const r = await http.post("/api/profiles/off", {});
  if (!r.was) {
    console.log("no profile was active — nothing to do");
    return;
  }
  console.log(`profile "${r.was}" is off — APX is back to vanilla`);
  if (r.routines?.length) console.log(`  routines disabled (not deleted): ${r.routines.join(", ")}`);
  console.log("  settings, tasks and memory were kept — `apx profile use` restores them");
}

// ── config ──────────────────────────────────────────────────────────────────

async function interactiveConfig(profile) {
  const props = profile.schema?.properties || {};
  const keys = Object.keys(props);
  if (!keys.length) {
    console.log(`profile "${profile.id}" has no configurable settings`);
    return {};
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const values = {};
  try {
    console.log(`Configuring ${profile.name}. Press enter to keep the current value.\n`);
    for (const key of keys) {
      const def = props[key];
      const current = profile.config?.[key];
      const hint = def.enum ? ` (${def.enum.join(" | ")})` : def.type ? ` (${def.type})` : "";
      const label = def.title || key;
      const answer = (await rl.question(`${label}${hint} [${current ?? ""}]: `)).trim();
      if (answer !== "") values[key] = answer;
    }
  } finally {
    rl.close();
  }
  return values;
}

export async function cmdProfileConfig(args) {
  const { active } = await http.get("/api/profiles");
  const id = args?.flags?.profile || active;
  if (!id) {
    console.error("apx profile config: no profile is active — run: apx profile use <id>");
    process.exit(1);
  }

  const profile = await http.get(`/api/profiles/${encodeURIComponent(id)}?preview=0`);

  let values = parseSetFlags(args?.flags);
  if (args?.flags?.interactive) {
    values = { ...values, ...(await interactiveConfig(profile)) };
  }

  // No changes asked for → show the current settings.
  if (!Object.keys(values).length) {
    const props = profile.schema?.properties || {};
    const keys = Object.keys(profile.config || {});
    if (!keys.length) {
      console.log(`profile "${id}" has no settings`);
      return;
    }
    console.log(`settings for ${profile.name} (${id}):`);
    for (const k of keys.sort()) {
      const def = props[k] || {};
      const allowed = def.enum ? `  [${def.enum.join(" | ")}]` : "";
      console.log(`  ${k.padEnd(24)} ${profile.config[k]}${allowed}`);
    }
    console.log("\nchange one with: apx profile config --set key=value");
    return;
  }

  const r = await http.patch("/api/profiles/config", { values, id });
  console.log(`updated: ${r.changed.join(", ")}`);
  for (const k of r.changed) console.log(`  ${k.padEnd(24)} ${r.config[k]}`);

  const { installed = [], skipped = [] } = r.routines || {};
  if (installed.length) console.log(`  routines rescheduled: ${installed.join(", ")}`);
  for (const s of skipped) {
    console.log(`  routine "${s.name}" left alone (${s.reason.replace(/_/g, " ")})`);
  }
}

// ── doctor / uninstall ──────────────────────────────────────────────────────

export async function cmdProfileDoctor(args) {
  const id = args._[0];
  const q = id ? `?id=${encodeURIComponent(id)}` : "";
  printDoctor(await http.get(`/api/profiles/doctor${q}`));
}

export async function cmdProfileUninstall(args) {
  const id = args._[0];
  if (!id) fail("uninstall", "missing <id>");

  const r = await http.delete(`/api/profiles/${encodeURIComponent(id)}`);
  console.log(`uninstalled "${r.id}" (${r.source})`);
  if (r.routines?.removed?.length) console.log(`  routines removed: ${r.routines.removed.join(", ")}`);
  if (r.routines?.kept?.length) {
    console.log(`  kept (you edited these): ${r.routines.kept.join(", ")}`);
  }
  if (r.source === "bundled") {
    console.log("  bundled package hidden — reinstall it any time with: apx profile install " + r.id);
  }
}
