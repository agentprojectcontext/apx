// Projects, agents, surfaces, engines, secrets and the v1 import.
import { randomUUID } from "node:crypto";
import { publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import type { Harnesses } from "../harness/index.ts";
import { importFromV1 } from "../import/v1.ts";
import type { Secrets } from "../secrets.ts";
import type { Handler } from "./router.ts";
import { notFound } from "./threads.ts";

export function appHandlers(deps: {
  store: Store;
  harnesses: Harnesses;
  secrets: Secrets;
  v1: { url: string; home: string };
}) {
  const { store, harnesses, secrets } = deps;
  return {
    "system.import_v1": (async ({ keys }) =>
      importFromV1(store, secrets, { ...deps.v1, keys })) as Handler<"system.import_v1">,
    "secrets.list": (() => ({ secrets: secrets.list() })) as Handler<"secrets.list">,
    "secrets.set": (({ name, value }) => {
      secrets.set(name, value);
      return { ok: true as const };
    }) as Handler<"secrets.set">,
    "agents.list": (() => ({ agents: store.agents.list().map(publicAgent) })) as Handler<"agents.list">,
    "agents.update": (({ agent, browser_profile, harness }) => {
      const cur = store.agents.get(agent);
      if (!cur) throw notFound(`agent ${agent}`);
      const { harness: _h, ...rest } = cur;
      const nextHarness = harness === undefined ? cur.harness : (harness ?? undefined);
      store.agents.upsert({
        ...rest,
        ...(browser_profile ? { browser_profile } : {}),
        ...(nextHarness ? { harness: nextHarness } : {}),
      });
      return publicAgent(store.agents.get(cur.id) ?? cur);
    }) as Handler<"agents.update">,
    "projects.list": (() => ({ projects: store.projects.list() })) as Handler<"projects.list">,
    "surfaces.list": (({ project_id }) => ({ surfaces: store.surfaces.list(project_id) })) as Handler<"surfaces.list">,
    "surfaces.get": (({ surface }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      return s;
    }) as Handler<"surfaces.get">,
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
    "engines.set_default": (async ({ engine }) => {
      harnesses.setDefault(engine);
      return { engines: await harnesses.status() };
    }) as Handler<"engines.set_default">,
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
