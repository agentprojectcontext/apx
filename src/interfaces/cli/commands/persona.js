// apx persona — install, activate and configure the super-agent's personality.
//
//   apx persona list
//   apx persona show <id>       [--preview]
//   apx persona install <id|path> [--force]
//   apx persona use <id>        [--force]
//   apx persona off
//   apx persona config          [--set k=v]... [--interactive]
//   apx persona doctor          [<id>]
//   apx persona uninstall <id>
//
// Everything goes through the daemon: activating a persona changes the live
// system prompt and rewrites the routine schedule, so the process that owns
// both has to apply it. Writing config from here would leave the running
// daemon out of date.
import readline from "node:readline/promises";
import { http } from "../http.js";

export const PERSONA_USAGE = {
  list:      "apx persona list",
  show:      "apx persona show <id> [--preview]",
  install:   "apx persona install <id|path> [--force]",
  use:       "apx persona use <id> [--force]",
  off:       "apx persona off",
  config:    "apx persona config [--set key=value]... [--interactive]",
  doctor:    "apx persona doctor [<id>]",
  uninstall: "apx persona uninstall <id>",
};

function fail(sub, msg) {
  console.error(`apx persona ${sub}: ${msg}`);
  console.error(`Usage: ${PERSONA_USAGE[sub]}`);
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
      console.error(`apx persona config: --set expects key=value — got "${s}"`);
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

export async function cmdPersonaList() {
  const { active, personas } = await http.get("/personas");
  if (!personas.length) {
    console.log("(no personas available)");
    return;
  }
  for (const p of personas) {
    const mark = p.active ? "*" : " ";
    const version = p.version ? ` v${p.version}` : "";
    console.log(`${mark} ${p.id.padEnd(16)} ${p.name}${version}  [${p.source}]`);
    if (p.description) console.log(`    ${p.description}`);
  }
  console.log("");
  console.log(active ? `active: ${active}` : "active: none (vanilla)");
}

// ── show ────────────────────────────────────────────────────────────────────

export async function cmdPersonaShow(args) {
  const id = args._[0];
  if (!id) fail("show", "missing <id>");

  const p = await http.get(`/personas/${encodeURIComponent(id)}`);
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

export async function cmdPersonaInstall(args) {
  const source = args._[0];
  if (!source) fail("install", "missing <id|path>");

  const r = await http.post("/personas/install", { source, force: !!args?.flags?.force });
  console.log(`installed ${r.persona.name} (${r.persona.id}) v${r.persona.version || "?"}`);
  console.log(`  prompt: ~${r.tokens} tokens`);
  printWarnings(r.warnings);
  console.log("");
  console.log(`Not active yet — run: apx persona use ${r.persona.id}`);
}

// ── use / off ───────────────────────────────────────────────────────────────

export async function cmdPersonaUse(args) {
  const id = args._[0];
  if (!id) fail("use", "missing <id>");

  const r = await http.post("/personas/use", { id, force: !!args?.flags?.force });
  console.log(`active persona: ${r.persona.name} (${r.persona.id})`);
  printWarnings(r.warnings);

  const { installed = [], skipped = [] } = r.routines || {};
  if (installed.length) console.log(`  routines installed: ${installed.join(", ")}`);
  for (const s of skipped) {
    console.log(`  routine "${s.name}" left alone (${s.reason.replace(/_/g, " ")})`);
  }
  if (!r.persona.active) console.log("  (warning: persona did not activate)");
}

export async function cmdPersonaOff() {
  const r = await http.post("/personas/off", {});
  if (!r.was) {
    console.log("no persona was active — nothing to do");
    return;
  }
  console.log(`persona "${r.was}" is off — APX is back to vanilla`);
  if (r.routines?.length) console.log(`  routines disabled (not deleted): ${r.routines.join(", ")}`);
  console.log("  settings, tasks and memory were kept — `apx persona use` restores them");
}

// ── config ──────────────────────────────────────────────────────────────────

async function interactiveConfig(persona) {
  const props = persona.schema?.properties || {};
  const keys = Object.keys(props);
  if (!keys.length) {
    console.log(`persona "${persona.id}" has no configurable settings`);
    return {};
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const values = {};
  try {
    console.log(`Configuring ${persona.name}. Press enter to keep the current value.\n`);
    for (const key of keys) {
      const def = props[key];
      const current = persona.config?.[key];
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

export async function cmdPersonaConfig(args) {
  const { active } = await http.get("/personas");
  const id = args?.flags?.persona || active;
  if (!id) {
    console.error("apx persona config: no persona is active — run: apx persona use <id>");
    process.exit(1);
  }

  const persona = await http.get(`/personas/${encodeURIComponent(id)}?preview=0`);

  let values = parseSetFlags(args?.flags);
  if (args?.flags?.interactive) {
    values = { ...values, ...(await interactiveConfig(persona)) };
  }

  // No changes asked for → show the current settings.
  if (!Object.keys(values).length) {
    const props = persona.schema?.properties || {};
    const keys = Object.keys(persona.config || {});
    if (!keys.length) {
      console.log(`persona "${id}" has no settings`);
      return;
    }
    console.log(`settings for ${persona.name} (${id}):`);
    for (const k of keys.sort()) {
      const def = props[k] || {};
      const allowed = def.enum ? `  [${def.enum.join(" | ")}]` : "";
      console.log(`  ${k.padEnd(24)} ${persona.config[k]}${allowed}`);
    }
    console.log("\nchange one with: apx persona config --set key=value");
    return;
  }

  const r = await http.patch("/personas/config", { values, id });
  console.log(`updated: ${r.changed.join(", ")}`);
  for (const k of r.changed) console.log(`  ${k.padEnd(24)} ${r.config[k]}`);

  const { installed = [], skipped = [] } = r.routines || {};
  if (installed.length) console.log(`  routines rescheduled: ${installed.join(", ")}`);
  for (const s of skipped) {
    console.log(`  routine "${s.name}" left alone (${s.reason.replace(/_/g, " ")})`);
  }
}

// ── doctor / uninstall ──────────────────────────────────────────────────────

export async function cmdPersonaDoctor(args) {
  const id = args._[0];
  const q = id ? `?id=${encodeURIComponent(id)}` : "";
  printDoctor(await http.get(`/personas/doctor${q}`));
}

export async function cmdPersonaUninstall(args) {
  const id = args._[0];
  if (!id) fail("uninstall", "missing <id>");

  const r = await http.delete(`/personas/${encodeURIComponent(id)}`);
  console.log(`uninstalled "${r.id}" (${r.source})`);
  if (r.routines?.removed?.length) console.log(`  routines removed: ${r.routines.removed.join(", ")}`);
  if (r.routines?.kept?.length) {
    console.log(`  kept (you edited these): ${r.routines.kept.join(", ")}`);
  }
  if (r.source === "bundled") {
    console.log("  bundled package hidden — reinstall it any time with: apx persona install " + r.id);
  }
}
