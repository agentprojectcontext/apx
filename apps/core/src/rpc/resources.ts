// Resources: skills (list, read, edit, on/off) and variables (stored secrets: hint and where each is used). MCP
// servers are in rpc/mcp.ts.

import path from "node:path";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { McpConfig, McpDef } from "../mcp/config.ts";
import { type Secrets, splitSecretName } from "../secrets.ts";
import { skillInfo, writeSkill } from "../skills/edit.ts";
import { allSkills, NO_GLOBALS, readSkillFile, setSkillOn, skillFiles, skillsOff } from "../skills/skills.ts";
import type { Handlers } from "./router.ts";

/** Where each stored secret is named: the owner's MCP servers, providers, channels, and services' own keys. */
function usedIn(store: Store, mcp: McpConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, where: string) => out.set(name, [...(out.get(name) ?? []), where]);
  const refs = (text: string) => [...text.matchAll(/secret:\/\/([a-zA-Z0-9_.-]+)/g)].map((m) => m[1] as string);
  const named = (d: McpDef) => new Set(refs(JSON.stringify([d.env, d.headers, d.args, d.url ?? ""])));
  for (const d of mcp.global()) for (const n of named(d)) add(n, `mcp:${d.name}`);
  // A project's own values ("<project>/<name>") are used by the owner's servers that project keeps on.
  for (const p of store.projects.list()) {
    const off = new Set(mcp.offIn(p.id));
    for (const d of mcp.global()) if (!off.has(d.name)) for (const n of named(d)) add(`${p.id}/${n}`, `mcp:${d.name}`);
  }
  for (const key of ["providers", "channels"] as const) {
    let entries: unknown;
    try {
      entries = JSON.parse(store.settings.get(key) ?? "null");
    } catch {}
    const list = Array.isArray(entries)
      ? entries
      : entries && typeof entries === "object"
        ? Object.entries(entries)
        : [];
    for (const e of list) {
      const id = Array.isArray(e) ? String(e[0]) : String((e as { id?: unknown }).id ?? key);
      for (const n of new Set(refs(JSON.stringify(e)))) add(n, `${key.slice(0, -1)}:${id}`);
    }
  }
  return out;
}

export function resourceHandlers(deps: { store: Store; home: string; secrets: Secrets; mcp: McpConfig }) {
  const { store, home, mcp } = deps;
  const find = (name: string, project: string | undefined) => {
    const s = allSkills(store, home, project).find((x) => x.name === name);
    if (!s) throw notFound(`skill ${name}`);
    return s;
  };
  const rootOf = (project: string | undefined) => {
    const p = project ? store.projects.get(project) : undefined;
    return p?.path && p.present ? p.path : undefined;
  };
  const inheritance = (project: string) => {
    if (!store.projects.get(project)) throw notFound(`project ${project}`);
    return { skills: !skillsOff(store)[project]?.includes(NO_GLOBALS), mcp: mcp.takesGlobals(project) };
  };
  return {
    "secrets.list": () => {
      const used = usedIn(store, deps.mcp);
      return {
        secrets: deps.secrets.list().map((s) => {
          const { project_id, name } = splitSecretName(s.name);
          if (project_id) return { ...s, name, project_id, used_in: used.get(`${project_id}/${name}`) ?? [] };
          // A service keeps its key under service-<id>: that name says where it is used.
          const service = s.name.startsWith("service-") ? [`service:${s.name.slice(8)}`] : [];
          return { ...s, used_in: [...(used.get(s.name) ?? []), ...service] };
        }),
      };
    },
    "skills.list": ({ project }) => ({
      skills: allSkills(store, home, project).map((s) => skillInfo(store, s, project)),
    }),
    "skills.get": ({ name, project }) => {
      const s = find(name, project);
      let content: string;
      try {
        content = readSkillFile(s);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return { skill: skillInfo(store, s, project), content, files: skillFiles(s) };
    },
    "skills.save": ({ name, target, project, content }) => {
      const current = allSkills(store, home, project).find((x) => x.name === name);
      if (current?.source === "extension" && target === "global")
        throw badRequest(`${name} comes from an extension; save it as a copy in a project or under another name`);
      if (target === "project" && !rootOf(project))
        throw badRequest("a project skill needs a project whose folder is on disk");
      // An existing skill is edited (or copied) in its own folder; a new one gets a folder named after it.
      const folder = current ? path.basename(current.dir) : name;
      try {
        writeSkill({ home, projectRoot: rootOf(project), folder, target, content });
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      // Found again by folder: the save may have changed the name in its frontmatter.
      const saved = allSkills(store, home, project).find(
        (x) => path.basename(x.dir) === folder && x.scope === target && x.source !== "extension",
      );
      if (!saved) throw badRequest("the skill was written but could not be read back (check its frontmatter)");
      return { skill: skillInfo(store, saved, project) };
    },
    "resources.inheritance": ({ project }) => inheritance(project),
    "resources.inherit": ({ project, kind, on }) => {
      if (!store.projects.get(project)) throw notFound(`project ${project}`);
      if (kind === "skills") setSkillOn(store, NO_GLOBALS, project, on);
      else mcp.setOn(project, NO_GLOBALS, on);
      return inheritance(project);
    },
    "skills.toggle": ({ name, project, on }) => {
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      find(name, project);
      setSkillOn(store, name, project, on);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
