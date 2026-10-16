// Skills: folders with a SKILL.md (frontmatter `name`, `description`; the body is the know-how). APX's own come with the
// core (`skills/apx/`), the owner's live in APX's home (`skills/`), a project's in `.apc/skills/`; the other agent
// apps' (Claude Code, Codex, Cursor, ~/.agents) are read where those apps keep them. Agents see a short catalog; the
// body loads on demand.
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { isInside, tildeHome } from "../paths.ts";
import { type RuntimeHomes, runtimes, shippedNames } from "./runtimes.ts";

/** The other agent apps whose skills APX reads: `~/.<app>/skills`, and `.<app>/skills` inside a project. */
export const APPS = ["claude", "codex", "cursor", "agents"] as const;
export type App = (typeof APPS)[number];

export type Skill = {
  name: string;
  description: string;
  scope: "global" | "project";
  project_id?: string | undefined;
  dir: string;
  /** Where its files live: APX itself, the owner's or a project's folder, an extension, or another agent app. */
  source: "apx" | "owner" | "project" | "extension" | App;
  /** In the owner's or the project's APX folder (a link there included): the Resources screen may write it. */
  own: boolean;
  /** The same name found elsewhere, hidden behind this one. */
  copies: SkillCopy[];
};

/** Another folder with a skill of the same name; `same` when its SKILL.md is identical. */
export type SkillCopy = Pick<Skill, "source" | "scope" | "dir"> & { same: boolean };

/** Where skills are looked for: APX's home and, when given, the homes of the other agent apps. */
export type SkillRoots = { home: string; apps?: RuntimeHomes | undefined };

/** APX's own guides to changing APX itself: shipped with the core, always on, read-only, and they keep their names. */
export const APX_SKILLS_DIR = path.join(import.meta.dirname, "apx");
const isApx = (s: Skill) => s.source === "apx";

/** Skills the owner turned off: "*" everywhere, or per project id. Kept in settings, never in the skill's folder. */
type OffList = Record<string, string[]>;
/** In a project's list: it does not take the owner's global skills at all (its own ones still count). */
export const NO_GLOBALS = "~globals";

export function skillsOff(store: Store): OffList {
  return store.settings.read("skills_off");
}

export function setSkillOn(store: Store, name: string, projectId: string | undefined, on: boolean): void {
  const all = skillsOff(store);
  const key = projectId ?? "*";
  const list = new Set(all[key] ?? []);
  if (on) list.delete(name);
  else list.add(name);
  all[key] = [...list];
  store.settings.write("skills_off", all);
}

/** Whether a skill is on in a project (or, without one, everywhere). */
export function skillOn(
  off: OffList,
  name: string,
  projectId: string | undefined,
  scope: Skill["scope"] = "global",
): boolean {
  if (off["*"]?.includes(name)) return false;
  if (projectId && scope === "global" && off[projectId]?.includes(NO_GLOBALS)) return false;
  return !(projectId && off[projectId]?.includes(name));
}

/** Skills listed in the prompt at most: past this the catalog says how many more there are. */
const CATALOG_MAX = 60;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Reads one skills folder. `allowLinks`: folders in the owner's home (APX's and the other apps') may link skills from
 * elsewhere; a project's may not (a repo must not pull another file of the machine into a prompt).
 */
function scan(
  root: string,
  allowLinks: boolean,
  base: Pick<Skill, "scope" | "project_id" | "source" | "own">,
  skip: ReadonlySet<string> = NONE,
): Skill[] {
  let names: string[] = [];
  try {
    if (!allowLinks && fs.lstatSync(root).isSymbolicLink()) return [];
    names = fs.readdirSync(root).filter((n) => NAME.test(n) && !skip.has(n));
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
      // A skill the owner linked in from another app's folder says whose it is (it is shared with that app).
      const source = base.source === "owner" && isLink(dir) ? (appOf(fs.realpathSync(dir)) ?? "owner") : base.source;
      return [{ name: textField(fields.name) ?? n, description, ...base, source, dir, copies: [] }];
    } catch {
      return [];
    }
  });
}

const NONE: ReadonlySet<string> = new Set();
const appOf = (real: string) => /[\\/]\.(claude|codex|cursor|agents)[\\/]/.exec(real)?.[1] as App | undefined;

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const realDir = (dir: string) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
};

const sameText = (a: string, b: string) => {
  try {
    return fs.readFileSync(path.join(a, "SKILL.md"), "utf8") === fs.readFileSync(path.join(b, "SKILL.md"), "utf8");
  } catch {
    return false;
  }
};

/** Skills an agent of this project may load: everything found, minus what the owner turned off. */
export function skillsFor(store: Store, roots: SkillRoots, projectId: string | undefined): Skill[] {
  const off = skillsOff(store);
  return allSkills(store, roots, projectId).filter((s) => isApx(s) || skillOn(off, s.name, projectId, s.scope));
}

/**
 * Every skill visible from a project (or globally), one per name. The first found wins it: APX's, the project's own,
 * the project's other apps' folders, the owner's, the other apps' folders in the home, then extensions'.
 */
export function allSkills(store: Store, roots: SkillRoots, projectId: string | undefined): Skill[] {
  const apx = scan(APX_SKILLS_DIR, false, { scope: "global", source: "apx", own: false });
  const project = projectId ? store.projects.get(projectId) : undefined;
  const repo = project?.path && project.present ? project.path : undefined;
  // `top` is the repo's `.apc` or `.<app>`: a link there would read a folder outside the project.
  const inRepo = (top: string, source: Skill["source"]) =>
    repo && project && !isLink(path.join(repo, top))
      ? scan(path.join(repo, top, "skills"), false, {
          scope: "project",
          project_id: project.id,
          source,
          own: source === "project",
        })
      : [];
  // The other apps keep copies of the skills APX writes for them (runtimes.ts): those are APX's, not theirs.
  const shipped = roots.apps ? shippedNames() : NONE;
  const apps = roots.apps
    ? runtimes(roots.apps).flatMap((r) =>
        scan(r.skills, true, { scope: "global", source: r.id as App, own: false }, shipped),
      )
    : [];
  const extensions = store.extensions
    .enabled()
    .flatMap((e) =>
      e.manifest.skills
        ? scan(path.resolve(e.dir, e.manifest.skills), false, { scope: "global", source: "extension", own: false })
        : [],
    );
  return firstPerName([
    ...apx,
    ...inRepo(".apc", "project"),
    ...APPS.flatMap((app) => inRepo(`.${app}`, app)),
    ...scan(path.join(roots.home, "skills"), true, { scope: "global", source: "owner", own: true }),
    ...apps,
    ...extensions,
  ]);
}

/**
 * Keeps the first skill of each name; later ones with that name become its copies (one folder reached twice, through a
 * link, is not a copy). A name of one of APX's own is APX's alone: another would change how agents learn to change APX.
 */
function firstPerName(found: Skill[]): Skill[] {
  const reserved = new Set(found.filter(isApx).map((s) => s.name));
  const first = new Map<string, { skill: Skill; dirs: Set<string> }>();
  for (const s of found) {
    if (!isApx(s) && reserved.has(s.name)) continue;
    const dir = realDir(s.dir);
    const kept = first.get(s.name);
    if (!kept) {
      first.set(s.name, { skill: s, dirs: new Set([dir]) });
      continue;
    }
    if (kept.dirs.has(dir)) continue;
    kept.dirs.add(dir);
    kept.skill.copies.push({ source: s.source, scope: s.scope, dir: s.dir, same: sameText(kept.skill.dir, s.dir) });
  }
  return [...first.values()].map((k) => k.skill).sort((a, b) => a.name.localeCompare(b.name));
}

/** A skill's folder as the panel shows it. */
export const skillPath = (dir: string) => tildeHome(path.join(dir, "SKILL.md"));

/**
 * The agent's `skills:` list narrows the catalog (APX's own always stay); an empty list (or one naming nothing found)
 * means all.
 */
export function agentSkills(agent: AgentRecord, all: Skill[]): Skill[] {
  const wanted = new Set((agent.skills ?? []).map((s) => s.toLowerCase()));
  const named = (s: Skill) => wanted.has(s.name.toLowerCase());
  return all.some(named) ? all.filter((s) => isApx(s) || named(s)) : all;
}

/**
 * For the system prompt: APX's own guides by name in one sentence (they are always there, so they must cost little),
 * then one line per other skill (first sentence of the description, capped).
 */
export function skillCatalog(skills: Skill[]): string {
  const apx = skills.filter(isApx).map((s) => s.name);
  const guides = apx.length
    ? `APX guides (${apx.join(", ")}): load_skill the right one first. Change APX via its tools or \`apx\`, never by editing files.`
    : "";
  const own = skills.filter((s) => !isApx(s));
  if (!own.length) return guides ? `## Skills\n${guides}` : "";
  const line = (s: Skill) => {
    const first = s.description.split(/(?<=[.!?])\s/)[0] ?? "";
    return `- ${s.name}: ${first.length > 180 ? `${first.slice(0, 177)}…` : first}`;
  };
  const more = own.length - CATALOG_MAX;
  return [
    "## Skills",
    ...(guides ? [guides] : []),
    "Know-how you can load when a task matches one: call load_skill with its name before doing the task.",
    ...own.slice(0, CATALOG_MAX).map(line),
    ...(more > 0 ? [`(${more} more not listed; load_skill works with any skill's name)`] : []),
  ].join("\n");
}

/** A skill's SKILL.md, or another file inside its folder (never outside it). */
export function readSkillFile(skill: Skill, file?: string): string {
  const root = fs.realpathSync(skill.dir);
  const inside = (p: string) => isInside(root, p);
  // Models often send an optional argument as "" or "."; both mean the skill itself.
  const name = file?.trim().replace(/^\.\/?$/, "") || "SKILL.md";
  // Checked before touching the disk (no probing for files elsewhere) and again after links are resolved.
  const asked = path.resolve(root, name);
  if (!inside(asked)) throw new Error(`${name} is outside the skill`);
  const target = fs.realpathSync(asked);
  if (!inside(target)) throw new Error(`${name} is outside the skill`);
  if (fs.statSync(target).isDirectory()) {
    const files = fs.readdirSync(target).filter((f) => !f.startsWith("."));
    return `${name} is a folder, not a file. Its files: ${files.join(", ") || "none"}. Load one with file=${name}/<file>.`;
  }
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
