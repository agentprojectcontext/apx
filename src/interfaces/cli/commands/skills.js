// apx skills — install the APX skill into AI IDE rule files.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { findApfRoot } from "#core/apc/parser.js";
import { http } from "../http.js";
import {
  IDE_TARGETS,
  installIdeSkills,
  installGlobalSkills,
  listBundledSkillSlugs,
  listBundledSkills,
} from "#core/apc/scaffold.js";

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
}

// ---------------------------------------------------------------------------
// apx skills sync — non-interactive refresh of every bundled skill to every
// global skill dir (.claude, .cursor, .codex, .agents). Same logic that runs
// from postinstall — exposed as a command so the user can force-refresh
// without reinstalling the package.
// ---------------------------------------------------------------------------

export async function cmdSkillsSync(args) {
  const includeOptional = !!args?.flags?.["include-optional"] || !!args?.flags?.optional;
  const includeInternal = !!args?.flags?.["include-internal"] || !!args?.flags?.internal;
  const prune = args?.flags?.["no-prune"] ? false : true;

  const results = installGlobalSkills({ includeOptional, includeInternal, prune });
  const home = os.homedir();

  // Group by skill so the output is dense and scannable.
  const bySkill = {};
  const scopeOf = {};
  for (const r of results) {
    if (!bySkill[r.skill]) bySkill[r.skill] = [];
    bySkill[r.skill].push({ dir: r.dir.replace(home, "~"), status: r.status });
    scopeOf[r.skill] = r.scope;
  }

  const slugs = Object.keys(bySkill).sort();
  if (slugs.length === 0) {
    console.log("(no bundled skills found in skills/)");
    return;
  }

  const filters = [];
  if (includeOptional) filters.push("+optional");
  if (includeInternal) filters.push("+internal");
  console.log(
    `Syncing ${slugs.length} bundled skill(s) to global skill dirs` +
      (filters.length ? ` [${filters.join(" ")}]` : "") + ":\n"
  );

  const sw = Math.max(...slugs.map((s) => s.length));
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
    const scope = scopeOf[slug];
    const tag = scope === "public" ? "" : ` [${scope}]`;
    console.log(`  ${slug.padEnd(sw)}${tag.padEnd(11)}  ${parts.join(", ")}`);
  }
  console.log("");
  console.log(`Targets: .claude/skills, .cursor/skills, .codex/skills, .agents/skills`);
  const totalParts = [];
  for (const k of ["created", "updated", "unchanged", "pruned"]) {
    if (totals[k]) totalParts.push(`${totals[k]} ${k}`);
  }
  console.log(`Totals:  ${totalParts.join(", ") || "(no changes)"}`);

  // Hint about non-default tiers.
  const skipped = listBundledSkills().filter(
    (s) =>
      (s.scope === "internal" && !includeInternal) ||
      (s.scope === "optional" && !includeOptional)
  );
  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped (not pushed by default):");
    for (const s of skipped) console.log(`  ${s.slug.padEnd(sw)}  scope=${s.scope}`);
    console.log("");
    console.log("Re-run with --include-optional / --include-internal to push them too,");
    console.log("or `apx skills add <slug> --global` for one-off install.");
  }

  if (args?.flags?.verbose) {
    console.log("");
    for (const slug of slugs) {
      console.log(`${slug}:`);
      for (const e of bySkill[slug]) {
        console.log(`  ${e.status.padEnd(10)}  ${e.dir}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// apx skills list
// ---------------------------------------------------------------------------

export async function cmdSkillsList(args = {}) {
  // --all queries the daemon, which returns project + global + bundled +
  // runtime-skills (same catalog the super-agent sees and the web picker uses).
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
    console.log(`SLUG`.padEnd(28) + "SOURCE".padEnd(10) + "DESCRIPTION");
    for (const s of out.skills) {
      const desc = (s.description || "").slice(0, 70);
      console.log(s.slug.padEnd(28) + (s.source || "?").padEnd(10) + desc);
    }
    return;
  }

  const root = findApfRoot();
  const skillsDir = root ? path.join(root, ".apc", "skills") : null;
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

  // Global — discovered list of every bundled skill with its scope.
  const bundled = listBundledSkills();
  const byScope = {
    public: bundled.filter((s) => s.scope === "public"),
    optional: bundled.filter((s) => s.scope === "optional"),
    internal: bundled.filter((s) => s.scope === "internal"),
  };
  console.log(
    `Bundled skills: ${bundled.length} total (${byScope.public.length} public, ` +
      `${byScope.optional.length} optional, ${byScope.internal.length} internal)`
  );
  console.log("");
  console.log(`Global skill dirs:`);
  const GLOBAL_DIRS = [
    { label: "Claude Code / Cursor compat", dir: path.join(os.homedir(), ".claude", "skills") },
    { label: "Cursor (primary)",            dir: path.join(os.homedir(), ".cursor", "skills") },
    { label: "Codex",                       dir: path.join(os.homedir(), ".codex",  "skills") },
    { label: "Antigravity / others",        dir: path.join(os.homedir(), ".agents", "skills") },
  ];
  const sw = Math.max(...bundled.map((s) => s.slug.length));
  for (const { label, dir } of GLOBAL_DIRS) {
    console.log(`\n  ${label} — ${dir.replace(os.homedir(), "~")}`);
    for (const { slug, scope } of bundled) {
      const dest = path.join(dir, slug, "SKILL.md");
      const present = fs.existsSync(dest);
      const tag = scope === "public" ? "" : ` [${scope}]`;
      const state = present
        ? "✓ installed"
        : (scope === "public" ? "✗ MISSING (run `apx skills sync`)" : "—");
      console.log(`    ${slug.padEnd(sw)}${tag.padEnd(11)}  ${state}`);
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
