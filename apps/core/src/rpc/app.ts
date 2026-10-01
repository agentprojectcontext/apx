// Projects, agents, surfaces, engines, secrets and the v1 import.
import { randomUUID } from "node:crypto";
import type { ApcSync } from "../apc/sync.ts";
import { publicProject } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import { summary } from "../domain/surfaces.ts";
import { CallError } from "../errors.ts";
import type { Harnesses } from "../harness/index.ts";
import { importFromV1 } from "../import/v1.ts";
import type { Catalog } from "../models/catalog.ts";
import { modelSettings, refProblem } from "../models/choice.ts";
import type { Secrets } from "../secrets.ts";
import { skillsFor } from "../skills/skills.ts";
import type { EngineIds } from "./agents.ts";
import type { Handler } from "./router.ts";
import { notFound } from "./threads.ts";

export function appHandlers(deps: {
  store: Store;
  harnesses: Harnesses;
  secrets: Secrets;
  v1: { url: string; home: string };
  catalog: Catalog;
  apc: ApcSync;
  engines: EngineIds;
  home: string;
}) {
  const { store, harnesses, secrets } = deps;
  const models = modelSettings(store);
  return {
    "system.import_v1": (async ({ keys }) =>
      importFromV1(deps.apc, secrets, { ...deps.v1, keys })) as Handler<"system.import_v1">,
    "secrets.list": (() => ({ secrets: secrets.list() })) as Handler<"secrets.list">,
    "secrets.set": (({ name, value }) => {
      secrets.set(name, value);
      return { ok: true as const };
    }) as Handler<"secrets.set">,
    "models.list": (async ({ refresh }) => ({ engines: await deps.catalog.list(refresh) })) as Handler<"models.list">,
    "models.config": (() => ({ default: models.defaultChoice(), router: models.router() })) as Handler<"models.config">,
    "models.set_config": ((p) => {
      const refs = [p.default?.model, ...(p.router?.chain ?? []), ...(p.router?.rules.map((r) => r.model) ?? [])];
      for (const ref of refs) {
        const why = ref ? refProblem(ref, deps.engines) : undefined;
        if (why) throw new CallError({ code: "bad_request", message: why });
      }
      models.save(p);
      return { default: models.defaultChoice(), router: models.router() };
    }) as Handler<"models.set_config">,
    "skills.list": (({ project }) => ({
      skills: skillsFor(store, deps.home, project).map(({ dir: _d, ...s }) => s),
    })) as Handler<"skills.list">,
    "projects.list": (() => ({ projects: store.projects.list().map(publicProject) })) as Handler<"projects.list">,
    "projects.register": (({ path }) => {
      let r: ReturnType<typeof deps.apc.register>;
      try {
        r = deps.apc.register(path);
      } catch (err) {
        throw new CallError({ code: "bad_request", message: err instanceof Error ? err.message : String(err) });
      }
      const project = store.projects.get(r.project);
      if (!project) throw notFound(`project ${r.project}`);
      return { project: publicProject(project), agents: r.agents };
    }) as Handler<"projects.register">,
    "projects.sync": (({ project }) => deps.apc.sync(project)) as Handler<"projects.sync">,
    "surfaces.list": (({ project_id }) => ({ surfaces: store.surfaces.list(project_id) })) as Handler<"surfaces.list">,
    "surfaces.get": (({ surface }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    }) as Handler<"surfaces.get">,
    "surfaces.show": ((p, ctx) => {
      const threadId = p.thread ?? ctx.agent?.thread_id;
      const thread = threadId ? store.threads.get(threadId) : undefined;
      if (threadId && !thread) throw notFound(`thread ${threadId}`);
      // A published widget is public: an agent may not change what its link shows; it makes a new one instead.
      const current = store.surfaces.byName(thread?.project_id, p.name);
      if (current?.share_path && ctx.actor !== "human")
        throw new CallError({
          code: "conflict",
          message: `widget "${p.name}" is published; use another name (the owner can unpublish it)`,
        });
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
    }) as Handler<"surfaces.show">,
    "surfaces.update": (({ surface, pinned, app }) => {
      const s = store.surfaces.patch(surface, { pinned, app });
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    }) as Handler<"surfaces.update">,
    "surfaces.share": (({ surface, shared }) => {
      const s = store.surfaces.share(surface, shared);
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    }) as Handler<"surfaces.share">,
    "engines.status": (async ({ refresh }) => ({
      engines: await harnesses.status(refresh),
    })) as Handler<"engines.status">,
    "harness.tools": (({ token }) => ({
      tools: harnesses.gate(token).tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    })) as Handler<"harness.tools">,
    "harness.call": (({ token, tool, args }) => {
      const g = harnesses.gate(token);
      return g.execute(`${g.run.id}-x${randomUUID().slice(0, 8)}`, tool, args);
    }) as Handler<"harness.call">,
  };
}
