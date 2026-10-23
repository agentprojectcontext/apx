// surfaces.* for an artifact's own memory (store, db), its bundle and its fetch. The page never names the surface:
// the web host passes its own id. See domain/artifact-memory.ts and artifact-fetch.ts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArtifactBundle, ArtifactManifest, Surface } from "@apx/protocol";
import { declaresApp, declaresLive } from "../../../../packages/surfaces/src/kit.ts";
import { artifactFetch } from "../artifact-fetch.ts";
import { artifactMemory, type SqlParam } from "../domain/artifact-memory.ts";
import { ownerIdentity } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import { summary } from "../domain/surfaces.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { PageCall, PageCheck } from "../nodes/page-check.ts";
import { type Secrets, splitSecretName } from "../secrets.ts";
import { withKit } from "../surface-kit.ts";
import type { Handlers } from "./router.ts";

/** The kit version a page loads (`/_apx/kit@1.2.js` → "1.2"). */
export function kitVersionOf(html: string): string | undefined {
  return /<script\b[^>]*\bsrc\s*=\s*["']?\/_apx\/kit@(\d+(?:\.\d+){0,2})\.js/i.exec(html)?.[1];
}

export function artifactHandlers(deps: {
  store: Store;
  secrets: Secrets;
  home: string;
  fetcher?: typeof fetch;
  /** The headless browser's page check, when one can run here. */
  checkPage?: ((html: string, onCall: PageCall) => Promise<PageCheck>) | undefined;
}) {
  /** Who made it, for its file: an installed one keeps its first maker; one made here names this APX's owner. */
  const madeBy = (s: Surface): Pick<ArtifactManifest, "author" | "agent" | "project"> => {
    if (s.origin) return { author: s.origin.author, agent: s.origin.agent, project: s.origin.project };
    const owner = ownerIdentity(store).name;
    const agent = s.created_by === "owner" ? undefined : store.agents.get(s.created_by)?.name;
    const project = s.project_id ? store.projects.get(s.project_id)?.name : undefined;
    return {
      ...(owner ? { author: owner.slice(0, 80) } : {}),
      ...(agent ? { agent: agent.slice(0, 80) } : {}),
      ...(project ? { project: project.slice(0, 120) } : {}),
    };
  };
  const { store, secrets } = deps;
  const memory = artifactMemory({ home: deps.home });
  const surfaceOf = (id: string): Surface => {
    const s = store.surfaces.get(id);
    if (!s) throw notFound(`surface ${id}`);
    return s;
  };
  const infoOf = (s: Surface) => ({
    state_chars: s.state ? JSON.stringify(s.state).length : 0,
    ...memory.info(s),
  });
  /** The secret keys this artifact has values for (its project's own and global ones), never the values. */
  const secretKeysOf = (s: Surface) => {
    const prefix = `artifact.${s.name}.`;
    const keys = new Set<string>();
    for (const { name } of secrets.list()) {
      const { project_id, name: plain } = splitSecretName(name);
      if (plain.startsWith(prefix) && (!project_id || project_id === s.project_id))
        keys.add(plain.slice(prefix.length));
    }
    return [...keys].sort();
  };

  return {
    "surfaces.check": async ({ html }) => {
      if (!deps.checkPage) return { checked: false, errors: [], text: "", views: [] };
      // A scratch memory per check: the page's first queries and writes run for real, on nothing of the owner's.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-check-"));
      const scratch = artifactMemory({ home: dir });
      const ref = { name: "check" };
      const onCall: PageCall = async (method, p) => {
        const params = (p.params as SqlParam[] | undefined) ?? [];
        if (method === "store_get") return { values: scratch.storeGet(ref, p.keys as string[] | undefined) };
        if (method === "store_set") return scratch.storeSet(ref, p.patch as Record<string, unknown>);
        if (method === "db_query") return scratch.query(ref, String(p.sql), params);
        if (method === "db_exec") return scratch.exec(ref, String(p.sql), params);
        return undefined;
      };
      try {
        return { checked: true, ...(await deps.checkPage(withKit(html), onCall)) };
      } catch (e) {
        return { checked: false, errors: [e instanceof Error ? e.message : String(e)], text: "", views: [] };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "surfaces.store_get": ({ surface, keys }) => ({ values: memory.storeGet(surfaceOf(surface), keys) }),
    "surfaces.store_set": ({ surface, patch }) => {
      if (Object.keys(patch).length > 1000) throw badRequest("at most 1000 keys per change");
      return memory.storeSet(surfaceOf(surface), patch);
    },
    "surfaces.db_query": ({ surface, sql, params }) => memory.query(surfaceOf(surface), sql, params),
    "surfaces.db_exec": ({ surface, sql, params }) => memory.exec(surfaceOf(surface), sql, params),
    "surfaces.memory": ({ surface }) => infoOf(surfaceOf(surface)),
    "surfaces.memory_clear": ({ surface, parts }) => {
      const s = surfaceOf(surface);
      if (parts.includes("state")) store.surfaces.setState(s.id, {}, true);
      memory.clear(s, { store: parts.includes("store"), db: parts.includes("db"), secrets: parts.includes("secrets") });
      return infoOf(surfaceOf(surface));
    },
    "surfaces.export": ({ surface, memory: withMemory }) => {
      const s = surfaceOf(surface);
      const kit = kitVersionOf(s.html);
      const secretKeys = secretKeysOf(s);
      const dataVersion = memory.dataVersion(s);
      const manifest: ArtifactManifest = {
        name: s.name,
        title: s.title,
        kind: s.app ? "app" : "widget",
        version: s.version,
        ...(kit ? { kit } : {}),
        ...(s.connect?.length ? { connect: s.connect } : {}),
        ...(secretKeys.length ? { secrets: secretKeys.slice(0, 20) } : {}),
        ...(declaresLive(s.html) !== undefined ? { live: true } : {}),
        ...(dataVersion !== undefined ? { data_version: dataVersion } : {}),
        ...madeBy(s),
        exported_at: new Date().toISOString(),
      };
      const bundle: ArtifactBundle = { format: "apx-artifact@1", manifest, html: s.html };
      if (withMemory) {
        if (s.state) bundle.state = s.state;
        const values = memory.storeGet(s);
        if (Object.keys(values).length) bundle.store = values;
        const db = memory.dump(s);
        if (db) bundle.db = db;
      }
      return bundle;
    },
    "surfaces.import": ({ bundle, project }) => {
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      const m = bundle.manifest;
      let name = m.name;
      for (let n = 2; store.surfaces.byName(project, name); n++) name = `${m.name.slice(0, 55)}-${n}`;
      const ref = { name, project_id: project };
      // Memory first, so a refused database leaves no artifact behind.
      memory.load(ref, { db: bundle.db, store: bundle.store });
      const created = store.surfaces.upsert({
        name,
        title: m.title,
        html: bundle.html,
        project_id: project,
        created_by: "owner",
        app: m.kind === "app" || declaresApp(bundle.html),
        ...(m.connect ? { connect: m.connect } : {}),
      });
      if (bundle.state && Object.keys(bundle.state).length) store.surfaces.setState(created.id, bundle.state, true);
      store.surfaces.setOrigin(created.id, {
        ...(m.author ? { author: m.author } : {}),
        ...(m.agent ? { agent: m.agent } : {}),
        ...(m.project ? { project: m.project } : {}),
        version: m.version,
        ...(m.exported_at ? { exported_at: m.exported_at } : {}),
        installed_at: new Date().toISOString(),
      });
      return summary(store.surfaces.get(created.id) ?? created);
    },
    "surfaces.fetch": async ({ surface, url, method, headers, body, secret }, ctx) => {
      // Only the owner's open page spends the artifact's credential; an agent's call would choose where it goes.
      if (secret && ctx.actor !== "human") throw unauthorized("only the artifact's page sends its secrets");
      const s = surfaceOf(surface);
      return artifactFetch(
        s,
        { url, method, headers, body, secret },
        (ref, projectId) => secrets.resolveIn(ref, projectId),
        { get: (key) => memory.pins(s)[key], set: (key, origin) => memory.pin(s, key, origin) },
        deps.fetcher,
      );
    },
  } satisfies Partial<Handlers>;
}
