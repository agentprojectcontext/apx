// apx2 skills install-runtimes: copies the skills that teach other agent runtimes (Claude Code, Codex, Cursor…) how
// to use APX into their skills folders. Local files only, like `apx2 service`: the core is not involved.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The skills APX ships for other runtimes, one folder each with a SKILL.md (apps/terminal/skills). */
export const sourceDir = () => path.resolve(import.meta.dirname, "../../skills");

/**
 * Folders APX once installed in runtimes and no longer ships: removed when found. Only names on this list or in
 * the shipped set are ever touched; every other skill in a runtime's folder belongs to someone else.
 */
export const RETIRED = [
  "apx-agency-agents",
  "apx-agent",
  "apx-mcp-builder",
  "apx-project",
  "apx-routine",
  "apx-runtime",
  "apx-sessions",
  "apx-skill-builder",
  "apx-task",
  "apx-telegram",
  "apx-voice",
  "claude-code",
  "codex-cli",
  "opencode-cli",
  "openrouter",
] as const;

export type Runtime = {
  id: string;
  label: string /** Present when the runtime is installed. */;
  root: string;
  skills: string;
};

/** Runtimes whose skills folder APX writes to; one only counts when its own folder exists. */
export function runtimes(home: string, env: NodeJS.ProcessEnv = {}): Runtime[] {
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  const at = (id: string, label: string, root: string): Runtime => ({
    id,
    label,
    root,
    skills: path.join(root, "skills"),
  });
  return [
    at("claude", "Claude Code", path.join(home, ".claude")),
    at("codex", "Codex", codex),
    at("cursor", "Cursor", path.join(home, ".cursor")),
    // The shared folder other runtimes read (skills.sh layout).
    at("agents", "Shared (~/.agents)", path.join(home, ".agents")),
  ];
}

export type Skill = { name: string; files: Record<string, string> };

/** Every shipped skill: each folder with a SKILL.md, with all its files (relative path → text). */
export function readSkills(dir: string): Skill[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => ({ name: e.name, files: readFiles(path.join(dir, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const file = path.join(dir, rel);
    if (fs.statSync(file).isFile() && !path.basename(rel).startsWith("."))
      out[rel.split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
  }
  return out;
}

export type Action = "create" | "update" | "unchanged" | "remove" | "skip-link";
export type Step = { runtime: Runtime; name: string; dir: string; action: Action };
export type Plan = { steps: Step[]; missing: Runtime[] };

const lstat = (p: string) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return undefined;
  }
};

/** What an install would do, touching nothing. A link in place of a skill is left alone: it points somewhere else. */
export function plan(skills: Skill[], targets: Runtime[]): Plan {
  const steps: Step[] = [];
  const missing: Runtime[] = [];
  const shipped = new Set(skills.map((s) => s.name));
  for (const runtime of targets) {
    if (!lstat(runtime.root)?.isDirectory()) {
      missing.push(runtime);
      continue;
    }
    for (const skill of skills) {
      const dir = path.join(runtime.skills, skill.name);
      const st = lstat(dir);
      const action: Action = !st
        ? "create"
        : st.isSymbolicLink()
          ? "skip-link"
          : st.isDirectory() && same(readFiles(dir), skill.files)
            ? "unchanged"
            : "update";
      steps.push({ runtime, name: skill.name, dir, action });
    }
    for (const name of RETIRED) {
      if (shipped.has(name)) continue;
      const dir = path.join(runtime.skills, name);
      if (lstat(dir)) steps.push({ runtime, name, dir, action: "remove" });
    }
  }
  return { steps, missing };
}

const same = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);

/** Carries out a plan: a shipped skill's folder becomes an exact copy; a retired one is removed (a link: unlinked). */
export function apply(p: Plan, skills: Skill[]): void {
  const byName = new Map(skills.map((s) => [s.name, s]));
  for (const step of p.steps) {
    if (step.action === "remove") {
      if (lstat(step.dir)?.isSymbolicLink()) fs.unlinkSync(step.dir);
      else fs.rmSync(step.dir, { recursive: true, force: true });
      continue;
    }
    if (step.action !== "create" && step.action !== "update") continue;
    const skill = byName.get(step.name);
    if (!skill) continue;
    fs.rmSync(step.dir, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(skill.files)) {
      const file = path.join(step.dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
}

const tilde = (p: string, home: string) => (p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);

export function installRuntimeSkills(opts: { dryRun?: boolean | undefined }): void {
  const home = os.homedir();
  const skills = readSkills(sourceDir());
  const p = plan(skills, runtimes(home, process.env));
  if (!opts.dryRun) apply(p, skills);
  const verb: Record<Action, string> = opts.dryRun
    ? {
        create: "would create",
        update: "would update",
        unchanged: "unchanged",
        remove: "would remove",
        "skip-link": "left alone (a link)",
      }
    : {
        create: "created",
        update: "updated",
        unchanged: "unchanged",
        remove: "removed",
        "skip-link": "left alone (a link)",
      };
  for (const s of p.steps)
    console.log(`${s.runtime.label.padEnd(20)} ${tilde(s.dir, home).padEnd(36)} ${verb[s.action]}`);
  for (const r of p.missing)
    console.log(`${r.label.padEnd(20)} ${tilde(r.root, home).padEnd(36)} not installed, skipped`);
  if (!p.steps.length) console.log("(no agent runtime found: nothing to do)");
}
