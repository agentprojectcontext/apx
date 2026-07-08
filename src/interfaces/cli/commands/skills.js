// apx skills — install the APX skill into AI IDE rule files.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { findApfRoot } from "#core/apc/parser.js";
import { apcSkillsDir } from "#core/apc/paths.js";
import { http } from "../http.js";
import {
  IDE_TARGETS,
  installIdeSkills,
  installGlobalSkills,
  listBundledSkillSlugs,
  listBundledSkills,
  listEngineSkills,
  listLegacyPruneSlugs,
} from "#core/apc/scaffold.js";
import {
  ensureIndex,
  planIndex,
  readIndex,
  clearIndex,
  indexPath,
} from "#core/agent/skills/index-store.js";
import { isInspectorEnabled } from "#core/agent/skills/inspector.js";
import {
  inspectPromptForSkills,
  summarizeTrace,
  INSPECTOR_DEFAULTS,
} from "#core/agent/skills/inspector.js";
import { KEYWORD_TRIGGER_DEFAULTS } from "#core/agent/skills/trigger.js";
import { listSkills } from "#core/agent/skills/loader.js";
import { readConfig, writeConfig } from "#core/config/index.js";

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// When the Skill Inspector is on, the catalog it scores against must stay in
// sync with what's installed. Called after add/sync so a freshly available
// skill is searchable immediately, without a separate `apx skills index`.
// No-op (silent) when the inspector is disabled — nothing reads the index then.
async function reindexInspectorIfEnabled() {
  let config;
  try {
    config = readConfig();
  } catch {
    return;
  }
  if (!isInspectorEnabled(config)) return;
  try {
    const plan = planIndex({});
    const work = plan.missing.length + plan.stale.length + plan.gone.length;
    if (work === 0) return;
    process.stdout.write(`\n  Skill Inspector on — reindexing ${work} changed skill(s)… `);
    const out = await ensureIndex({ embedOpts: { globalConfig: config } });
    const c = out.changed;
    console.log(`done (${out.embedder}: +${c.added.length} ~${c.refreshed.length} -${c.removed.length}).`);
  } catch (e) {
    console.log(`\n  (skill index refresh failed: ${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// apx skills add [<target>...] [--global] [--project]
// ---------------------------------------------------------------------------

export async function cmdSkillsAdd(args) {
  const forceGlobal = !!args.flags.global;
  const forceProject = !!args.flags.project;
  const hasTargets = args._.length > 0;

  // If neither flag given and no specific targets, ask the user.
  let scope;
  if (forceGlobal) {
    scope = "global";
  } else if (forceProject || hasTargets) {
    scope = "project";
  } else {
    console.log("Where do you want to install the APX skill?\n");
    console.log("  [g] Global  — ~/.claude/skills/, ~/.cursor/skills/, ~/.agents/skills/");
    console.log("               Works across all your projects (recommended for first install).");
    console.log("  [p] Project — .claude/skills/apx/, .cursor/rules/apx.mdc, .windsurf/rules/apx.md, etc.");
    console.log("               Scoped to this project only.\n");
    const answer = await ask("Choice [g/p] (default: g): ");
    scope = answer === "p" || answer === "project" ? "project" : "global";
  }

  if (scope === "global") {
    const results = installGlobalSkills();
    const home = os.homedir();
    console.log("");
    for (const r of results) {
      const short = r.file.replace(home, "~");
      console.log(`  ${r.status.padEnd(10)}  ${short}`);
    }
    console.log("\n  Loaded by: Claude Code, Cursor, Codex (OpenAI), Antigravity, and skills.sh-compatible tools.");
    console.log("  Activates automatically when working in a project with AGENTS.md or .apc/");
    await reindexInspectorIfEnabled();
    return;
  }

  // Project scope
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project (run `apx init` first)");

  const requested = hasTargets ? args._.map((s) => s.toLowerCase()) : null;
  if (requested) {
    const unknown = requested.filter((id) => !IDE_TARGETS.some((t) => t.id === id));
    if (unknown.length) {
      throw new Error(
        `unknown target(s): ${unknown.join(", ")}\nAvailable: ${IDE_TARGETS.map((t) => t.id).join(", ")}`
      );
    }
  }

  const results = installIdeSkills(root, requested);
  console.log("");
  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(width)}  ${r.status.padEnd(16)}  ${r.file}`);
  }
  const notes = IDE_TARGETS.filter((t) => t.note && (!requested || requested.includes(t.id)));
  if (notes.length) {
    console.log("");
    for (const t of notes) console.log(`  note: ${t.note}`);
  }
  await reindexInspectorIfEnabled();
}

// ---------------------------------------------------------------------------
// apx skills sync — non-interactive refresh of every bundled skill to every
// global skill dir (.claude, .cursor, .codex, .agents). Same logic that runs
// from postinstall — exposed as a command so the user can force-refresh
// without reinstalling the package.
// ---------------------------------------------------------------------------

export async function cmdSkillsSync(args) {
  const prune = args?.flags?.["no-prune"] ? false : true;

  const results = installGlobalSkills({ prune });
  const home = os.homedir();

  const bySkill = {};
  for (const r of results) {
    if (!bySkill[r.skill]) bySkill[r.skill] = [];
    bySkill[r.skill].push({ dir: r.dir.replace(home, "~"), status: r.status, scope: r.scope });
  }

  const engineSet = listEngineSkills().map((s) => s.slug);
  if (engineSet.length === 0) {
    console.log("(no engine skills found in skills/engines/)");
    return;
  }

  console.log(`Syncing engine skill set (${engineSet.join(", ")}) to global dirs:\n`);

  const slugs = Object.keys(bySkill).sort();
  const sw = Math.max(...slugs.map((s) => s.length), 8);
  const totals = { unchanged: 0, updated: 0, created: 0, pruned: 0 };
  for (const slug of slugs) {
    const entries = bySkill[slug];
    const counts = { unchanged: 0, updated: 0, created: 0, pruned: 0 };
    for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
    for (const k of Object.keys(totals)) totals[k] += counts[k] || 0;
    const parts = [];
    for (const k of ["created", "updated", "unchanged", "pruned"]) {
      if (counts[k]) parts.push(`${counts[k]} ${k}`);
    }
    const tag = entries[0]?.scope === "legacy" ? " [legacy]" : "";
    console.log(`  ${slug.padEnd(sw)}${tag.padEnd(10)}  ${parts.join(", ")}`);
  }
  console.log("");
  console.log(`Targets: .claude/skills, .cursor/skills, .codex/skills, .agents/skills`);
  const totalParts = [];
  for (const k of ["created", "updated", "unchanged", "pruned"]) {
    if (totals[k]) totalParts.push(`${totals[k]} ${k}`);
  }
  console.log(`Totals:  ${totalParts.join(", ") || "(no changes)"}`);

  if (args?.flags?.verbose) {
    console.log("");
    for (const slug of slugs) {
      console.log(`${slug}:`);
      for (const e of bySkill[slug]) {
        console.log(`  ${e.status.padEnd(10)}  ${e.dir}`);
      }
    }
  }
  await reindexInspectorIfEnabled();
}

// ---------------------------------------------------------------------------
// apx skills list
// ---------------------------------------------------------------------------

export async function cmdSkillsList(args = {}) {
  // --all queries the daemon, which returns project + global + bundled
  // (the same catalog the super-agent sees and the web picker uses).
  // Without --all we only list `.apc/skills/` (what the user installed in
  // THIS project), matching the historical behaviour.
  if (args?.flags?.all) {
    const root = findApfRoot();
    const params = root ? `?project_path=${encodeURIComponent(root)}` : "";
    const out = await http.get(`/skills${params}`);
    if (!out.count) {
      console.log("(no skills available)");
      return;
    }
    console.log(`SLUG`.padEnd(28) + "SOURCE".padEnd(10) + "STATE".padEnd(10) + "DESCRIPTION");
    for (const s of out.skills) {
      const desc = (s.description || "").slice(0, 70);
      const state = s.private ? "private" : s.enabled === false ? "off" : "on";
      console.log(s.slug.padEnd(28) + (s.source || "?").padEnd(10) + state.padEnd(10) + desc);
    }
    return;
  }

  const root = findApfRoot();
  const skillsDir = root ? apcSkillsDir(root) : null;
  const files = skillsDir && fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"))
    : [];

  if (files.length === 0) {
    console.log("(no skills installed in .apc/skills/ — try `apx skills list --all` for the full catalog)");
    return;
  }
  for (const f of files) console.log(f.replace(/\.md$/, ""));
}

// ---------------------------------------------------------------------------
// apx skills status
// ---------------------------------------------------------------------------

export async function cmdSkillsStatus() {
  const root = findApfRoot();

  const engineSet = listEngineSkills();        // what we publish to engines
  const bundled = listBundledSkills();          // what stays in-repo for the super-agent
  const legacy = listLegacyPruneSlugs();        // slugs APX shipped historically — pruned on sync

  console.log(
    `Engine skill set (replicated to global dirs): ${engineSet.length} ` +
      `(${engineSet.map((s) => s.slug).join(", ") || "—"})`
  );
  console.log(`In-repo bundled skills (super-agent only): ${bundled.length}`);
  console.log("");
  console.log(`Global skill dirs:`);
  const GLOBAL_DIRS = [
    { label: "Claude Code / Cursor compat", dir: path.join(os.homedir(), ".claude", "skills") },
    { label: "Cursor (primary)",            dir: path.join(os.homedir(), ".cursor", "skills") },
    { label: "Codex",                       dir: path.join(os.homedir(), ".codex",  "skills") },
    { label: "Antigravity / others",        dir: path.join(os.homedir(), ".agents", "skills") },
  ];
  const allSlugs = [...engineSet.map((s) => s.slug), ...legacy];
  const sw = Math.max(...allSlugs.map((s) => s.length), 8);
  for (const { label, dir } of GLOBAL_DIRS) {
    console.log(`\n  ${label} — ${dir.replace(os.homedir(), "~")}`);
    for (const { slug } of engineSet) {
      const dest = path.join(dir, slug, "SKILL.md");
      const present = fs.existsSync(dest);
      const state = present ? "✓ installed" : "✗ MISSING (run `apx skills sync`)";
      console.log(`    ${slug.padEnd(sw)}             ${state}`);
    }
    const stale = legacy.filter((slug) =>
      fs.existsSync(path.join(dir, slug, "SKILL.md"))
    );
    if (stale.length) {
      for (const slug of stale) {
        console.log(`    ${slug.padEnd(sw)} [legacy]    ⚠ stale (run \`apx skills sync\` to prune)`);
      }
    }
  }

  // Project-scoped
  if (root) {
    console.log("\nProject skills (this project only):");
    const width = Math.max(...IDE_TARGETS.map((t) => t.label.length));
    for (const t of IDE_TARGETS) {
      const dest = path.join(root, t.file);
      let status;
      if (!fs.existsSync(dest)) {
        status = "not installed";
      } else if (t.guard) {
        const txt = fs.readFileSync(dest, "utf8");
        status = txt.includes(t.guard) ? "installed" : "file exists (no apx block)";
      } else {
        status = "installed";
      }
      console.log(`  ${t.label.padEnd(width)}  ${status}`);
    }
    console.log(`  ${"Codex / Antigravity".padEnd(width)}  reads AGENTS.md (automatic)`);
  }

  console.log("\n  Tip: run `apx skills add` for an interactive install.");
  console.log("  Claude Desktop has no project-file support (use apx-mcp instead).");
}

// ---------------------------------------------------------------------------
// apx skills index [--reset] [--force]
//
// Build the persistent vector index that powers the skill Inspector. Runs the
// configured embedding provider (defaults to local: ollama → tf fallback) over
// every skill's condensed description and writes ~/.apx/skills/.index.json.
// ---------------------------------------------------------------------------

function renderBar(done, total, width = 24) {
  if (!Number.isFinite(total) || total <= 0) return "";
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * width);
  return "[" + "█".repeat(filled) + " ".repeat(width - filled) + "]";
}

export async function cmdSkillsIndex(args = {}) {
  const reset = !!args?.flags?.reset;
  const force = !!args?.flags?.force;
  if (reset) clearIndex();

  const config = readConfig();
  const root = findApfRoot();
  const projectPath = root || undefined;

  const plan = planIndex({ projectPath });
  if (plan.total === 0) {
    console.log("(no skills available — install some first with `apx skills sync` or drop a SKILL.md in ~/.apx/skills/<slug>/)");
    return;
  }

  const headline = force
    ? `Rebuilding index for ${plan.total} skills (force).`
    : `Indexing ${plan.total} skills (${plan.existing.length} cached · ${plan.missing.length} new · ${plan.stale.length} stale · ${plan.gone.length} gone).`;
  console.log(headline);

  const t0 = Date.now();
  let lastLine = "";
  const out = await ensureIndex({
    projectPath,
    embedOpts: { globalConfig: config },
    force,
    onProgress: ({ done, total, slug, action }) => {
      const bar = renderBar(done, total);
      const tag = action.padEnd(9);
      const line = `\r${bar} ${done}/${total}  ${tag}  ${slug}`.padEnd(lastLine.length, " ");
      process.stdout.write(line);
      lastLine = line;
    },
  });

  const elapsedMs = Date.now() - t0;
  process.stdout.write("\r" + " ".repeat(lastLine.length) + "\r");

  const c = out.changed;
  console.log(
    `Done in ${(elapsedMs / 1000).toFixed(1)}s using ${out.embedder} (dim ${out.dim}).\n` +
    `  added:     ${c.added.length}\n` +
    `  refreshed: ${c.refreshed.length}\n` +
    `  removed:   ${c.removed.length}\n` +
    `  kept:      ${c.kept.length}\n` +
    `  index:     ${indexPath()}`
  );
  if (c.added.length || c.refreshed.length) {
    const sample = [...c.added, ...c.refreshed].slice(0, 6).join(", ");
    if (sample) console.log(`  changes:   ${sample}${(c.added.length + c.refreshed.length) > 6 ? ", …" : ""}`);
  }
  if (out.embedder === "tf") {
    console.log("  note:      using offline TF fallback (no embedding provider reachable). Configure one in config.memory.embeddings for better recall.");
  }
}

// ---------------------------------------------------------------------------
// apx skills inspect <prompt>
//
// Show what the Inspector would inject for a given user prompt. Doesn't touch
// the model — pure middleware debug. Useful to tune thresholds and to see why
// a skill did or didn't fire.
// ---------------------------------------------------------------------------

export async function cmdSkillsInspect(args) {
  const promptParts = args?._ || [];
  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    console.error("usage: apx skills inspect \"<prompt text>\"");
    process.exitCode = 2;
    return;
  }

  const config = readConfig();
  const root = findApfRoot();
  const projectPath = root || undefined;

  // Force the inspector on for this command even if config has it off — the
  // operator is explicitly asking "what WOULD the inspector do?".
  const probedConfig = structuredClone(config);
  probedConfig.skills = probedConfig.skills || {};
  probedConfig.skills.inspector = {
    ...INSPECTOR_DEFAULTS,
    ...(probedConfig.skills.inspector || {}),
    enabled: true,
  };

  const out = await inspectPromptForSkills({
    prompt,
    projectPath,
    globalConfig: probedConfig,
  });

  console.log(`prompt:    ${prompt}`);
  console.log(`embedder:  ${out.trace.embedder || "(none)"}`);
  console.log(`decision:  ${summarizeTrace(out.trace)}`);
  if (out.trace.scored?.length) {
    console.log("scores:");
    for (const s of out.trace.scored) console.log(`  ${s.sim.toFixed(3)}  ${s.slug}`);
  }
  if (out.contextNote) {
    console.log("");
    console.log("--- contextNote that would be injected ---");
    console.log(out.contextNote);
    console.log("--- end ---");
  }
}

// ---------------------------------------------------------------------------
// apx skills inspector [enable|disable|status|set <key> <value>]
//
// Manage config.skills.inspector. All keys live under that namespace; this
// command is a thin shortcut so you don't have to remember the path.
// ---------------------------------------------------------------------------

const KNOWN_INSPECTOR_KEYS = Object.keys(INSPECTOR_DEFAULTS);

function ensureInspectorBlock(cfg) {
  cfg.skills = cfg.skills || {};
  cfg.skills.inspector = { ...INSPECTOR_DEFAULTS, ...(cfg.skills.inspector || {}) };
  return cfg;
}

function printInspectorStatus(cfg) {
  const insp = cfg.skills?.inspector || {};
  const merged = { ...INSPECTOR_DEFAULTS, ...insp };
  console.log(`Skill Inspector: ${merged.enabled ? "ENABLED" : "disabled"}`);
  for (const k of KNOWN_INSPECTOR_KEYS) {
    if (k === "enabled") continue;
    console.log(`  ${k.padEnd(16)} ${merged[k]}`);
  }
  const idx = readIndex();
  const count = Object.keys(idx.items || {}).length;
  console.log("");
  console.log(`Index: ${count} skills (${idx.embedder || "—"}, dim ${idx.dim || "—"})`);
  console.log(`File:  ${indexPath()}`);
}

export async function cmdSkillsInspector(args) {
  const sub = (args?._ || [])[0];
  const cfg = readConfig();

  if (!sub || sub === "status") {
    printInspectorStatus(cfg);
    return;
  }
  if (sub === "enable" || sub === "on") {
    ensureInspectorBlock(cfg).skills.inspector.enabled = true;
    writeConfig(cfg);
    console.log("Skill Inspector ENABLED. The catalog-wide hint block will be suppressed; per-turn RAG decides what skills go into context.");
    console.log("Tip: run `apx skills index` once so the inspector has cached vectors to score against.");
    return;
  }
  if (sub === "disable" || sub === "off") {
    ensureInspectorBlock(cfg).skills.inspector.enabled = false;
    writeConfig(cfg);
    console.log("Skill Inspector disabled. Falling back to the legacy slug hint + passive RAG nudge.");
    return;
  }
  if (sub === "set") {
    const key = args._[1];
    const value = args._[2];
    if (!key || value === undefined) {
      console.error("usage: apx skills inspector set <key> <value>");
      console.error(`keys: ${KNOWN_INSPECTOR_KEYS.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    if (!KNOWN_INSPECTOR_KEYS.includes(key)) {
      console.error(`unknown key "${key}". Known: ${KNOWN_INSPECTOR_KEYS.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    ensureInspectorBlock(cfg);
    const def = INSPECTOR_DEFAULTS[key];
    let coerced = value;
    if (typeof def === "boolean") coerced = value === "true" || value === "1" || value === "on";
    else if (typeof def === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        console.error(`value for "${key}" must be a number; got "${value}"`);
        process.exitCode = 2;
        return;
      }
      coerced = n;
    }
    cfg.skills.inspector[key] = coerced;
    writeConfig(cfg);
    console.log(`skills.inspector.${key} = ${coerced}`);
    return;
  }

  console.error(`unknown inspector subcommand: ${sub}`);
  console.error("usage: apx skills inspector [status|enable|disable|set <key> <value>]");
  process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// apx skills triggers [show|on|off]
//
// Manage config.skills.keyword_triggers — the opt-in "option B" keyword
// activation (OpenHands-style). Mirrors `apx skills inspector`: writes the
// global config directly, no daemon round-trip needed.
// ---------------------------------------------------------------------------

function ensureKeywordTriggersBlock(cfg) {
  cfg.skills = cfg.skills || {};
  cfg.skills.keyword_triggers = { ...KEYWORD_TRIGGER_DEFAULTS, ...(cfg.skills.keyword_triggers || {}) };
  return cfg;
}

function printKeywordTriggersStatus(cfg) {
  const merged = { ...KEYWORD_TRIGGER_DEFAULTS, ...(cfg.skills?.keyword_triggers || {}) };
  console.log(`Skill keyword triggers: ${merged.enabled ? "ENABLED" : "disabled"}`);
  console.log(`  ${"max_matches".padEnd(16)} ${merged.max_matches}`);
  console.log(`  ${"body_char_cap".padEnd(16)} ${merged.body_char_cap}`);

  const root = findApfRoot();
  const declaring = listSkills({ projectPath: root || undefined })
    .filter((s) => Array.isArray(s.triggers) && s.triggers.length > 0);
  console.log("");
  if (!declaring.length) {
    console.log("No skill declares `triggers:` in its frontmatter yet.");
    return;
  }
  console.log(`Skills declaring triggers (${declaring.length}):`);
  const sw = Math.max(...declaring.map((s) => s.slug.length), 8);
  for (const s of declaring) {
    console.log(`  ${s.slug.padEnd(sw)}  [${s.source}]  ${s.triggers.join(", ")}`);
  }
}

export async function cmdSkillsTriggers(args) {
  const sub = (args?._ || [])[0];
  const cfg = readConfig();

  if (!sub || sub === "show") {
    printKeywordTriggersStatus(cfg);
    return;
  }
  if (sub === "on") {
    ensureKeywordTriggersBlock(cfg).skills.keyword_triggers.enabled = true;
    writeConfig(cfg);
    console.log("Skill keyword triggers ENABLED. Skills with `triggers:` in their frontmatter are auto-injected when a keyword appears in the user message.");
    console.log("Tip: run `apx skills triggers` to see which skills declare triggers.");
    return;
  }
  if (sub === "off") {
    ensureKeywordTriggersBlock(cfg).skills.keyword_triggers.enabled = false;
    writeConfig(cfg);
    console.log("Skill keyword triggers disabled. Skills activate via /slug, the inspector, or the passive suggestion as before.");
    return;
  }

  console.error(`unknown triggers subcommand: ${sub}`);
  console.error("usage: apx skills triggers [show|on|off]");
  process.exitCode = 2;
}
