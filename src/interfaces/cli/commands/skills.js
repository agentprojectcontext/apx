// apx skills — install the APX skill into AI IDE rule files.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { findApfRoot } from "../../../core/parser.js";
import { IDE_TARGETS, installIdeSkills, installGlobalSkills } from "../../../core/scaffold.js";

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
// apx skills list
// ---------------------------------------------------------------------------

export async function cmdSkillsList() {
  const root = findApfRoot();
  const skillsDir = root ? path.join(root, ".apc", "skills") : null;
  const files = skillsDir && fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"))
    : [];

  if (files.length === 0) {
    console.log("(no skills installed in .apc/skills/)");
    return;
  }
  for (const f of files) console.log(f.replace(/\.md$/, ""));
}

// ---------------------------------------------------------------------------
// apx skills status
// ---------------------------------------------------------------------------

export async function cmdSkillsStatus() {
  const root = findApfRoot();

  // Global
  const SKILL_SLUGS = ["apx", "apc-context"];
  console.log("Global skills:");
  const GLOBAL_DIRS = [
    { label: "Claude Code / Cursor compat", dir: path.join(os.homedir(), ".claude", "skills") },
    { label: "Cursor (primary)",            dir: path.join(os.homedir(), ".cursor", "skills") },
    { label: "Codex",                       dir: path.join(os.homedir(), ".codex",  "skills") },
    { label: "Antigravity / others",        dir: path.join(os.homedir(), ".agents", "skills") },
  ];
  const gw = Math.max(...GLOBAL_DIRS.map((d) => d.label.length));
  const sw = Math.max(...SKILL_SLUGS.map((s) => s.length));
  for (const { label, dir } of GLOBAL_DIRS) {
    for (const slug of SKILL_SLUGS) {
      const dest = path.join(dir, slug, "SKILL.md");
      console.log(`  ${label.padEnd(gw)}  ${slug.padEnd(sw)}  ${fs.existsSync(dest) ? "installed" : "not installed"}`);
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
