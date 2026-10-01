// The app's settings and catalog: projects, surfaces, models and the router, skills, secrets, desktop prefs and the
// v1 import. (Agents live in rpc/agents.ts.)
import { randomUUID } from "node:crypto";
import type { ApcSync } from "../apc/sync.ts";
import { publicProject } from "../domain/projects.ts";
import type { EngineIds } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { summary } from "../domain/surfaces.ts";
import { badRequest, conflict, errorMessage, notFound } from "../errors.ts";
import type { Harnesses } from "../harness/index.ts";
import { importFromV1 } from "../import/v1.ts";
import type { Catalog } from "../models/catalog.ts";
import { modelSettings, refProblem } from "../models/choice.ts";
import type { Secrets } from "../secrets.ts";
import type { Services } from "../services/registry.ts";
import { skillsFor } from "../skills/skills.ts";
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
}) {
  const { store, harnesses, secrets } = deps;
  const models = modelSettings(store);
  return {
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
    "secrets.list": () => ({ secrets: secrets.list() }),
    "desktop.get": () => desktopPrefs(store),
    "desktop.set": (p) => {
      store.settings.set("desktop", JSON.stringify(p));
      return desktopPrefs(store);
    },
    "secrets.set": ({ name, value }) => {
      secrets.set(name, value);
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
    "skills.list": ({ project }) => ({
      skills: skillsFor(store, deps.home, project).map(({ dir: _d, ...s }) => s),
    }),
    "projects.list": () => ({ projects: store.projects.list().map(publicProject) }),
    "projects.register": ({ path }) => {
      let r: ReturnType<typeof deps.apc.register>;
      try {
        r = deps.apc.register(path);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      const project = store.projects.get(r.project);
      if (!project) throw notFound(`project ${r.project}`);
      return { project: publicProject(project), agents: r.agents };
    },
    "projects.sync": ({ project }) => deps.apc.sync(project),
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
function desktopPrefs(store: Store): { shortcut: string; launch_at_login: boolean } {
  try {
    const p = JSON.parse(store.settings.get("desktop") ?? "{}") as { shortcut?: unknown; launch_at_login?: unknown };
    return {
      shortcut: typeof p.shortcut === "string" ? p.shortcut : "Alt+Space",
      launch_at_login: p.launch_at_login === true,
    };
  } catch {
    return { shortcut: "Alt+Space", launch_at_login: false };
  }
}
