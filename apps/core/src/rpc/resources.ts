// Resources: skills (list, read, edit, on/off) and variables (stored secrets: hint and where each is used). MCP
// servers are in rpc/mcp.ts.

import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { McpConfig } from "../mcp/config.ts";
import type { Secrets } from "../secrets.ts";
import { skillInfo, writeSkill } from "../skills/edit.ts";
import { allSkills, readSkillFile, setSkillOn, skillFiles } from "../skills/skills.ts";
import type { Handlers } from "./router.ts";

/** Where each stored secret is named: the owner's MCP servers, providers, channels, and services' own keys. */
function usedIn(store: Store, mcp: McpConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, where: string) => out.set(name, [...(out.get(name) ?? []), where]);
  const refs = (text: string) => [...text.matchAll(/secret:\/\/([a-zA-Z0-9_.-]+)/g)].map((m) => m[1] as string);
  for (const d of mcp.global())
    for (const n of new Set(refs(JSON.stringify([d.env, d.headers, d.args, d.url ?? ""])))) add(n, `mcp:${d.name}`);
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
  const { store, home } = deps;
  const find = (name: string, project: string | undefined) => {
    const s = allSkills(store, home, project).find((x) => x.name === name);
    if (!s) throw notFound(`skill ${name}`);
    return s;
  };
  const rootOf = (project: string | undefined) => {
    const p = project ? store.projects.get(project) : undefined;
    return p?.path && p.present ? p.path : undefined;
  };
  return {
    "secrets.list": () => {
      const used = usedIn(store, deps.mcp);
      return {
        secrets: deps.secrets.list().map((s) => {
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
      try {
        writeSkill({ home, projectRoot: rootOf(project), name, target, content });
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return { skill: skillInfo(store, find(name, project), project) };
    },
    "skills.toggle": ({ name, project, on }) => {
      find(name, project);
      setSkillOn(store, name, project, on);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
