// The app's settings and catalog: projects, surfaces, models and the router, skills, secrets, desktop prefs and the
// v1 import. (Agents live in rpc/agents.ts.)

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Organization } from "@apx/protocol";
import { readOrganization, writeOrganization } from "../apc/org.ts";
import type { ApcSync } from "../apc/sync.ts";
import { writeProjectMeta } from "../apc/write.ts";
import { ownerIdentity, saveOwnerIdentity } from "../domain/owner.ts";
import { publicProject } from "../domain/projects.ts";
import type { EngineIds } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { summary } from "../domain/surfaces.ts";
import { badRequest, conflict, errorMessage, notFound } from "../errors.ts";
import type { Harnesses } from "../harness/index.ts";
import { importFromV1 } from "../import/v1.ts";
import type { Catalog } from "../models/catalog.ts";
import { modelSettings, refProblem } from "../models/choice.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";
import type { Services } from "../services/registry.ts";
import type { Handlers } from "./router.ts";

export function appHandlers(deps: {
  store: Store;
  harnesses: Harnesses;
  secrets: Secrets;
  v1: { url: string; home: string };
  catalog: Catalog;
  apc: ApcSync;
  engines: EngineIds;
  home: string;
  services: Services;
  /** Whether this machine has Messages (a Mac). */
  imessage: boolean;
}) {
  const { store, harnesses, secrets } = deps;
  const models = modelSettings(store);
  /** A registered project's folder, when it is on disk. */
  const folderOf = (id: string) => {
    const p = store.projects.get(id);
    if (!p) throw notFound(`project ${id}`);
    if (!p.path || !p.present) throw badRequest(`the folder of ${p.name} is not on disk right now`);
    return p.path;
  };
  return {
    "owner.get": () => ownerIdentity(deps.store),
    "owner.set": (patch) => saveOwnerIdentity(deps.store, patch),
    "system.import_v1": async ({ keys, skills, services }) =>
      importFromV1(deps.apc, secrets, {
        ...deps.v1,
        v2Home: deps.home,
        keys,
        skills,
        // Only what v2 does not have yet: an import never overwrites the owner's own settings.
        services: services
          ? (list) =>
              list.flatMap(({ id, settings }) => {
                if (deps.services.has(id)) return [];
                deps.services.set(id, settings);
                return [id];
              })
          : undefined,
      }),
    "imessage.get": () => ({ available: deps.imessage, on: deps.imessage && store.settings.read("imessage").on }),
    "imessage.set": ({ on }) => {
      store.settings.write("imessage", { on });
      return { available: deps.imessage, on: deps.imessage && on };
    },
    "desktop.get": () => desktopPrefs(store),
    "desktop.set": (p) => {
      store.settings.write("desktop", p);
      return desktopPrefs(store);
    },
    "secrets.set": ({ name, value, project }) => {
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      secrets.set(project ? projectSecretName(project, name) : name, value);
      return { ok: true as const };
    },
    "models.list": async ({ refresh }) => ({ engines: await deps.catalog.list(refresh) }),
    "models.config": () => ({ default: models.defaultChoice(), router: models.router() }),
    "models.set_config": (p) => {
      const refs = [p.default?.model, ...(p.router?.chain ?? []), ...(p.router?.rules.map((r) => r.model) ?? [])];
      for (const ref of refs) {
        const why = ref ? refProblem(ref, deps.engines) : undefined;
        if (why) throw badRequest(why);
      }
      models.save(p);
      return { default: models.defaultChoice(), router: models.router() };
    },
    "projects.list": ({ include_unregistered }) => ({
      projects: store.projects.list(include_unregistered).map(publicProject),
      base: store.settings.read("base_project"),
    }),
    "projects.update_base": ({ name, description, kind }) => {
      const cur = store.settings.read("base_project");
      const desc = description === undefined ? cur.description : description || undefined;
      const k = kind === undefined ? cur.kind : (kind ?? undefined);
      store.settings.write("base_project", {
        name: name ?? cur.name,
        ...(desc ? { description: desc } : {}),
        ...(k ? { kind: k } : {}),
      });
      return { base: store.settings.read("base_project") };
    },
    "org.get": ({ project }) => {
      if (!project) return store.settings.read("base_org");
      return readOrganization(folderOf(project));
    },
    "org.set": ({ project, organization }) => {
      const org = checkOrg(organization);
      if (!project) {
        store.settings.write("base_org", org);
        return store.settings.read("base_org");
      }
      const root = folderOf(project);
      try {
        writeOrganization(root, org);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return readOrganization(root);
    },
    "projects.register": ({ path: dir, init }) => {
      let r: ReturnType<typeof deps.apc.register>;
      try {
        if (init) initProject(dir);
        r = deps.apc.register(dir);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      const project = store.projects.get(r.project);
      if (!project) throw notFound(`project ${r.project}`);
      return { project: publicProject(project), agents: r.agents };
    },
    "projects.update": ({ project: id, name, description, kind }) => {
      const project = store.projects.get(id);
      if (!project) throw notFound(`project ${id}`);
      if (!project.path) throw badRequest(`${project.name} has no folder to keep its settings in`);
      if (!project.present) throw badRequest(`the folder of ${project.name} is not on disk right now`);
      try {
        writeProjectMeta(project.path, { name, description, kind });
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      deps.apc.sync(id);
      const now = store.projects.get(id);
      if (!now) throw notFound(`project ${id}`);
      return { project: publicProject(now) };
    },
    "projects.sync": ({ project }) => deps.apc.sync(project),
    "projects.unregister": ({ project: id }) => {
      if (!store.projects.get(id)) throw notFound(`project ${id}`);
      deps.apc.unregister(id);
      return { ok: true as const };
    },
    "surfaces.list": ({ project_id }) => ({ surfaces: store.surfaces.list(project_id) }),
    "surfaces.get": ({ surface }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    },
    "surfaces.show": (p, ctx) => {
      const threadId = p.thread ?? ctx.agent?.thread_id;
      const thread = threadId ? store.threads.get(threadId) : undefined;
      if (threadId && !thread) throw notFound(`thread ${threadId}`);
      // A published widget is public: an agent may not change what its link shows; it makes a new one instead.
      const current = store.surfaces.byName(thread?.project_id, p.name);
      if (current?.share_path && ctx.actor !== "human")
        throw conflict(`widget "${p.name}" is published; use another name (the owner can unpublish it)`);
      return summary(
        store.surfaces.upsert({
          name: p.name,
          title: p.title,
          html: p.html,
          project_id: thread?.project_id,
          thread_id: thread?.id,
          created_by: ctx.agent?.id ?? "owner",
          pinned: p.pinned,
          app: p.app,
          connect: p.connect,
        }),
      );
    },
    "surfaces.update": ({ surface, pinned, app }) => {
      const s = store.surfaces.patch(surface, { pinned, app });
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    },
    "surfaces.share": ({ surface, shared }) => {
      const s = store.surfaces.share(surface, shared);
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    },
    "engines.status": async ({ refresh }) => ({
      engines: await harnesses.status(refresh),
    }),
    "harness.tools": ({ token }) => ({
      tools: harnesses.gate(token).tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }),
    "harness.call": ({ token, tool, args }) => {
      const g = harnesses.gate(token);
      return g.execute(`${g.run.id}-x${randomUUID().slice(0, 8)}`, tool, args);
    },
  } satisfies Partial<Handlers>;
}

/** The quick chat opens with Option+Space unless the owner picked another shortcut. */
const desktopPrefs = (store: Store) => store.settings.read("desktop");

/** Makes a plain folder an APC project, writing only what is missing: AGENTS.md (named after it) and .apc/. */
function initProject(dir: string): void {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
  const agents = path.join(abs, "AGENTS.md");
  if (!fs.existsSync(agents)) fs.writeFileSync(agents, `# ${path.basename(abs)}\n`);
  fs.mkdirSync(path.join(abs, ".apc"), { recursive: true });
}

/** Slugs are unique, and a role's area is one of the areas (a removed area leaves its roles general, as in v1). */
function checkOrg(org: Organization): Organization {
  const areas = [...new Map(org.areas.map((a) => [a.slug, a])).values()];
  const known = new Set(areas.map((a) => a.slug));
  const roles = [...new Map(org.roles.map((r) => [r.slug, r])).values()].map(({ area, ...r }) =>
    area && known.has(area) ? { ...r, area } : r,
  );
  return { areas, roles };
}
