// Reading and writing a skill's SKILL.md for the Resources screen. The owner's skills live in APX's home; a project's
// in `.apc/skills/`, written without following a symlink out of the repo. APX's, extensions' and the other apps' skills
// are read-only here (one of those is copied into APX to be changed).
import fs from "node:fs";
import path from "node:path";
import type { SkillInfo } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { writeAtomic } from "../paths.ts";
import { NO_GLOBALS, type Skill, skillOn, skillPath, skillsOff } from "./skills.ts";

/** What the panel shows about a skill, in the context it was asked from. */
export function skillInfo(store: Store, s: Skill, projectId: string | undefined): SkillInfo {
  const off = skillsOff(store);
  const offIn =
    s.scope === "global"
      ? Object.keys(off).filter((k) => k !== "*" && (off[k]?.includes(s.name) || off[k]?.includes(NO_GLOBALS)))
      : [];
  return {
    name: s.name,
    description: s.description,
    scope: s.scope,
    ...(s.project_id ? { project_id: s.project_id } : {}),
    source: s.source,
    on: s.source === "apx" || skillOn(off, s.name, projectId, s.scope),
    off_in: s.source === "apx" ? [] : offIn,
    off_everywhere: s.source !== "apx" && Boolean(off["*"]?.includes(s.name)),
    editable: s.own,
    path: skillPath(s.dir),
    copies: s.copies.map((c) => ({ source: c.source, scope: c.scope, path: skillPath(c.dir), same: c.same })),
  };
}

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Writes SKILL.md in folder `folder`: the project's `.apc/skills/<folder>/` (refusing any symlink on the way) or the
 * owner's `<home>/skills/<folder>/` (which may be a link the owner made; the write goes to its target). The folder,
 * not the frontmatter `name`, says which skill it is: the two may differ.
 */
export function writeSkill(o: {
  home: string;
  projectRoot?: string | undefined;
  folder: string;
  target: "global" | "project";
  content: string;
}): string {
  if (o.target === "project") {
    if (!o.projectRoot) throw new Error("a project skill needs a project whose folder is on disk");
    const parts = [".apc", "skills", o.folder, "SKILL.md"];
    for (let i = 1; i <= parts.length; i++) {
      const p = path.join(o.projectRoot, ...parts.slice(0, i));
      if (isLink(p)) throw new Error(`refusing to write through a symlink: ${parts.slice(0, i).join("/")}`);
    }
    const file = path.join(o.projectRoot, ...parts);
    writeAtomic(file, o.content);
    return path.dirname(file);
  }
  const dir = path.join(o.home, "skills", o.folder);
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : dir;
  writeAtomic(path.join(real, "SKILL.md"), o.content);
  return dir;
}
