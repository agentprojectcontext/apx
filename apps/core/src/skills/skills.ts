// Skills: folders with a SKILL.md (frontmatter `name`, `description`; the body is the know-how). The owner's live in
// APX's home (`skills/`), a project's in `.apc/skills/`. Agents see a one-line catalog; the body loads on demand.
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";

export type Skill = {
  name: string;
  description: string;
  scope: "global" | "project";
  project_id?: string | undefined;
  dir: string;
};

/** Skills listed in the prompt at most: past this the catalog says how many more there are. */
const CATALOG_MAX = 60;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Reads one skills folder. `allowLinks`: the owner's own folder may link skills from elsewhere; a project's may not
 * (a repo must not pull another file of the machine into a prompt).
 */
function scan(root: string, allowLinks: boolean, base: Pick<Skill, "scope" | "project_id">): Skill[] {
  let names: string[] = [];
  try {
    if (!allowLinks && fs.lstatSync(root).isSymbolicLink()) return [];
    names = fs.readdirSync(root).filter((n) => NAME.test(n));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const dir = path.join(root, n);
    const file = path.join(dir, "SKILL.md");
    try {
      if (!allowLinks && (fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink())) return [];
      const { fields } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const description = (textField(fields.description) ?? "").replace(/\s+/g, " ").trim();
      return [{ name: textField(fields.name) ?? n, description, ...base, dir }];
    } catch {
      return [];
    }
  });
}

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export function skillsFor(store: Store, home: string, projectId: string | undefined): Skill[] {
  const project = projectId ? store.projects.get(projectId) : undefined;
  const own = scan(path.join(home, "skills"), true, { scope: "global" });
  const theirs =
    project?.path && project.present && !isLink(path.join(project.path, ".apc"))
      ? scan(path.join(project.path, ".apc", "skills"), false, { scope: "project", project_id: project.id })
      : [];
  // A project's skill with the same name as one of the owner's takes its place inside that project.
  const names = new Set(theirs.map((s) => s.name));
  return [...theirs, ...own.filter((s) => !names.has(s.name))].sort((a, b) => a.name.localeCompare(b.name));
}

/** The agent's `skills:` list narrows the catalog; an empty list (or one naming nothing found) means all. */
export function agentSkills(agent: AgentRecord, all: Skill[]): Skill[] {
  const wanted = new Set((agent.skills ?? []).map((s) => s.toLowerCase()));
  const picked = all.filter((s) => wanted.has(s.name.toLowerCase()));
  return wanted.size && picked.length ? picked : all;
}

/** One line per skill for the system prompt (first sentence of the description, capped). */
export function skillCatalog(skills: Skill[]): string {
  if (!skills.length) return "";
  const line = (s: Skill) => {
    const first = s.description.split(/(?<=[.!?])\s/)[0] ?? "";
    return `- ${s.name}: ${first.length > 180 ? `${first.slice(0, 177)}…` : first}`;
  };
  const more = skills.length - CATALOG_MAX;
  return [
    "## Skills",
    "Know-how you can load when a task matches one: call load_skill with its name before doing the task.",
    ...skills.slice(0, CATALOG_MAX).map(line),
    ...(more > 0 ? [`(${more} more not listed; load_skill works with any skill's name)`] : []),
  ].join("\n");
}

/** A skill's SKILL.md, or another file inside its folder (never outside it). */
export function readSkillFile(skill: Skill, file?: string): string {
  const root = fs.realpathSync(skill.dir);
  const inside = (p: string) => p === root || p.startsWith(`${root}${path.sep}`);
  // Checked before touching the disk (no probing for files elsewhere) and again after links are resolved.
  const asked = path.resolve(root, file ?? "SKILL.md");
  if (!inside(asked)) throw new Error(`${file} is outside the skill`);
  const target = fs.realpathSync(asked);
  if (!inside(target)) throw new Error(`${file} is outside the skill`);
  return fs.readFileSync(target, "utf8");
}

/** The files a skill brings besides SKILL.md (scripts, references), one level deep. */
export function skillFiles(skill: Skill): string[] {
  try {
    return fs
      .readdirSync(skill.dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? fs.readdirSync(path.join(skill.dir, e.name)).map((f) => `${e.name}/${f}`)
          : e.name === "SKILL.md" || e.name.startsWith(".")
            ? []
            : [e.name],
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}
