// Agent templates: folders of APC agent files that can be copied into a project. A sub-folder with TEAM.md is a
// team (its members are the .md files beside it); loose .md files are single agents. Read-only, no symlinks: the
// v1 vault is read and never written.
import fs from "node:fs";
import path from "node:path";
import {
  type AgentTemplate,
  ProjectKind,
  type TeamTemplate,
  TemplateRoutine,
  type TemplateSource,
} from "@apx/protocol";
import { z } from "zod";
import { parseFrontmatter, textField } from "./frontmatter.ts";
import { type ApcAgent, readAgentDir, readText, SLUG_RE } from "./read.ts";

export type TemplateRoot = { source: TemplateSource; dir: string };

/**
 * A template with what installing needs: the file's text as written, the routines it comes with in full, and the
 * kind of project its team makes.
 */
export type TemplateFile = AgentTemplate & { text: string; routineSpecs: TemplateRoutine[]; teamKind?: ProjectKind };

const RoutineFile = z.array(TemplateRoutine).max(10);

/** `<slug>.routines.json` beside the agent's file; a missing or malformed one means no routines, never an error. */
function routinesOf(dir: string, slug: string): TemplateRoutine[] {
  const file = path.join(dir, `${slug}.routines.json`);
  if (!small(file)) return [];
  try {
    return RoutineFile.parse(JSON.parse(readText(file) ?? "[]"));
  } catch {
    return [];
  }
}

const TEAM_FILE = "TEAM.md";
/** A template folder is small; a bigger one is not a template folder. */
const MAX_ENTRIES = 200;
/** An agent file is a page or two; anything bigger is skipped rather than read on every listing. */
const MAX_FILE = 64 * 1024;

const small = (file: string) => {
  try {
    return fs.lstatSync(file).size <= MAX_FILE;
  } catch {
    return false;
  }
};

const isDir = (p: string) => {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

function entries(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort().slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function toTemplate(source: TemplateSource, team: string, dir: string, a: ApcAgent, members: ApcAgent[]): TemplateFile {
  const inTeam = (slug: string | undefined) => Boolean(slug && members.some((m) => m.slug === slug));
  const area = textField(a.fields.area ?? a.fields.Area);
  const routineSpecs = routinesOf(dir, a.slug);
  return {
    id: `${source}:${team}:${a.slug}`,
    source,
    slug: a.slug,
    name: a.name,
    role: a.role,
    ...(a.description ? { description: a.description } : {}),
    ...(inTeam(a.parent) ? { parent: a.parent } : {}),
    ...(area ? { area } : {}),
    lead: !inTeam(a.parent),
    routines: routineSpecs.map((r) => ({ name: r.name, schedule: r.schedule })),
    text: readText(path.join(dir, `${a.slug}.md`)) ?? "",
    routineSpecs,
  };
}

/** Every team and single agent under the roots. A root that does not exist is simply empty. */
export function readTemplates(roots: TemplateRoot[]): { teams: TeamTemplate[]; files: TemplateFile[] } {
  const teams: TeamTemplate[] = [];
  const files: TemplateFile[] = [];
  for (const { source, dir } of roots) {
    if (!isDir(dir)) continue;
    for (const name of entries(dir)) {
      const sub = path.join(dir, name);
      if (!isDir(sub) || !SLUG_RE.test(name)) continue;
      const head = readText(path.join(sub, TEAM_FILE));
      const meta = head ? parseFrontmatter(head).fields : {};
      const members = readAgentDir(sub).filter((m) => small(path.join(sub, `${m.slug}.md`)));
      if (!members.length) continue;
      const kind = ProjectKind.safeParse(textField(meta.kind)).data;
      const list = treeOrder(
        members.map((m) => ({ ...toTemplate(source, name, sub, m, members), ...(kind ? { teamKind: kind } : {}) })),
      );
      teams.push({
        id: `${source}:${name}`,
        source,
        name: textField(meta.name) ?? name,
        ...(textField(meta.description) ? { description: textField(meta.description) } : {}),
        ...(kind ? { kind } : {}),
        members: list.map(({ text: _t, routineSpecs: _r, teamKind: _k, ...m }) => m),
      });
      files.push(...list);
    }
    const loose = readAgentDir(dir).filter((a) => small(path.join(dir, `${a.slug}.md`)));
    files.push(...loose.map((a) => toTemplate(source, "-", dir, a, [])));
  }
  return { teams, files };
}

/** Lead first, then each member followed by its own reports, so a team reads top-down. */
function treeOrder(list: TemplateFile[]): TemplateFile[] {
  const out: TemplateFile[] = [];
  const visit = (parent: string | undefined) => {
    for (const m of list
      .filter((x) => (parent ? x.parent === parent : x.lead))
      .sort((a, b) => a.name.localeCompare(b.name)))
      if (!out.includes(m)) {
        out.push(m);
        visit(m.slug);
      }
  };
  visit(undefined);
  return [...out, ...list.filter((m) => !out.includes(m))];
}

/** Single agents to offer: loose files plus every team member, one per slug (the first one found wins). */
export function singlesOf(files: TemplateFile[]): AgentTemplate[] {
  const seen = new Set<string>();
  return files
    .filter((f) => !seen.has(f.slug) && seen.add(f.slug))
    .map(({ text: _t, routineSpecs: _r, parent: _p, teamKind: _k, ...f }) => ({ ...f, lead: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
