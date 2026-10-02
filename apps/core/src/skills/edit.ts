// Reading and writing a skill's SKILL.md for the Resources screen. The owner's skills live in APX's home; a project's
// in `.apc/skills/`, written without following a symlink out of the repo. Extensions' skills are read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillInfo } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { type Skill, skillOn, skillsOff } from "./skills.ts";

const tilde = (p: string) => {
  const home = os.homedir();
  return p === home || p.startsWith(`${home}${path.sep}`) ? `~${p.slice(home.length)}` : p;
};

/** What the panel shows about a skill, in the context it was asked from. */
export function skillInfo(store: Store, s: Skill, projectId: string | undefined): SkillInfo {
  const off = skillsOff(store);
  const offIn = s.scope === "global" ? Object.keys(off).filter((k) => k !== "*" && off[k]?.includes(s.name)) : [];
  return {
    name: s.name,
    description: s.description,
    scope: s.scope,
    ...(s.project_id ? { project_id: s.project_id } : {}),
    source: s.source,
    on: skillOn(off, s.name, projectId),
    off_in: offIn,
    editable: s.source !== "extension",
    path: tilde(path.join(s.dir, "SKILL.md")),
  };
}

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

function atomicWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Writes SKILL.md for `name`: into the project's `.apc/skills/<name>/` (refusing any symlink on the way) or the
 * owner's `<home>/skills/<name>/` (which may be a link the owner made; the write goes to its target).
 */
export function writeSkill(o: {
  home: string;
  projectRoot?: string | undefined;
  name: string;
  target: "global" | "project";
  content: string;
}): string {
  if (o.target === "project") {
    if (!o.projectRoot) throw new Error("a project skill needs a project whose folder is on disk");
    const parts = [".apc", "skills", o.name, "SKILL.md"];
    for (let i = 1; i <= parts.length; i++) {
      const p = path.join(o.projectRoot, ...parts.slice(0, i));
      if (isLink(p)) throw new Error(`refusing to write through a symlink: ${parts.slice(0, i).join("/")}`);
    }
    const file = path.join(o.projectRoot, ...parts);
    atomicWrite(file, o.content);
    return path.dirname(file);
  }
  const dir = path.join(o.home, "skills", o.name);
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : dir;
  atomicWrite(path.join(real, "SKILL.md"), o.content);
  return dir;
}
