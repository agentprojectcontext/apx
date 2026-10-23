// Widgets, sidebar panels and fullscreen apps: one primitive. Addressed by id; an agent updates its own by
// stable name within a project (`upsert`).
import { randomUUID } from "node:crypto";
import {
  ArtifactOrigin,
  SURFACE_STATE_MAX,
  type Surface,
  SurfaceOrigin,
  SurfaceState,
  type SurfaceSummary,
} from "@apx/protocol";
import type { ExpressionBuilder, Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { Database, SurfacesTable } from "../db/schema.ts";
import { badRequest } from "../errors.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const toSurface = (r: Selectable<SurfacesTable>): Surface => ({
  id: r.id,
  name: r.name,
  title: r.title,
  html: r.html,
  version: r.version,
  pinned: Boolean(r.pinned),
  app: Boolean(r.app),
  ...opt("project_id", r.project_id),
  ...opt("thread_id", r.thread_id),
  created_by: r.created_by,
  updated_at: r.updated_at,
  ...(r.share_token ? { share_path: `/a/${r.share_token}` } : {}),
  ...connectOf(r.connect),
  ...stateOf(r.state),
  ...originOf(r.origin),
});

/** The stored state, when it is still an object of JSON values (anything else reads as nothing remembered). */
function stateOf(raw: string | null): { state?: SurfaceState } {
  if (!raw) return {};
  try {
    const parsed = SurfaceState.safeParse(JSON.parse(raw));
    return parsed.success && Object.keys(parsed.data).length ? { state: parsed.data } : {};
  } catch {
    return {};
  }
}

/** Where it was installed from, while the stored JSON still reads as one. */
function originOf(raw: string | null): { origin?: ArtifactOrigin } {
  if (!raw) return {};
  try {
    const parsed = ArtifactOrigin.safeParse(JSON.parse(raw));
    return parsed.success ? { origin: parsed.data } : {};
  } catch {
    return {};
  }
}

/** The stored origins, kept only while they still look like one (a hand-edited row cannot widen the CSP). */
function connectOf(raw: string | null): { connect?: string[] } {
  if (!raw) return {};
  const parsed = SurfaceOrigin.array().max(5).safeParse(JSON.parse(raw));
  return parsed.success && parsed.data.length ? { connect: parsed.data } : {};
}

/** The surfaces of a project, or the global ones when there is no project. */
const inScope = (projectId: string | undefined) => (eb: ExpressionBuilder<Database, "surfaces">) =>
  eb(eb.fn.coalesce("project_id", eb.val("")), "=", projectId ?? "");

/** The surface named `name` in a project, or among global ones when there is no project. */
const named = (projectId: string | undefined, name: string) => (eb: ExpressionBuilder<Database, "surfaces">) =>
  eb.and([inScope(projectId)(eb), eb("name", "=", name)]);

export const summary = ({ html: _html, state: _state, ...rest }: Surface): SurfaceSummary => rest;

export function surfacesRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (s: Surface) => bus.emit({ type: "surface.updated", surface: summary(s) });
  const repo = {
    /** Every surface, or only one project's (`project: undefined` is the global ones), never mixing the two. */
    list(only?: { project: string | undefined }): SurfaceSummary[] {
      const q = qb.selectFrom("surfaces").selectAll().orderBy("updated_at", "desc");
      return all(only ? q.where(inScope(only.project)) : q).map((r) => summary(toSurface(r)));
    },
    get(id: string): Surface | undefined {
      const r = one(qb.selectFrom("surfaces").selectAll().where("id", "=", id));
      return r ? toSurface(r) : undefined;
    },
    /** A surface by its stable name within a project (or among global ones). */
    byName(projectId: string | undefined, name: string): Surface | undefined {
      const r = one(qb.selectFrom("surfaces").selectAll().where(named(projectId, name)));
      return r ? toSurface(r) : undefined;
    },
    /** Deletes the widget's row; its memory folder is the caller's to remove. */
    remove(id: string): boolean {
      if (!repo.get(id)) return false;
      run(qb.deleteFrom("surfaces").where("id", "=", id));
      bus.emit({ type: "surface.deleted", surface_id: id });
      return true;
    },
    byShareToken(token: string): Surface | undefined {
      const r = one(qb.selectFrom("surfaces").selectAll().where("share_token", "=", token));
      return r ? toSurface(r) : undefined;
    },
    upsert(s: {
      name: string;
      title: string;
      html: string;
      project_id?: string | undefined;
      thread_id?: string | undefined;
      created_by: string;
      pinned?: boolean | undefined;
      app?: boolean | undefined;
      /** Absent keeps the current origins; [] removes them. */
      connect?: string[] | undefined;
    }): Surface {
      const existing = one(qb.selectFrom("surfaces").selectAll().where(named(s.project_id, s.name)));
      const ts = now();
      if (existing) {
        const cur = toSurface(existing);
        const next: Surface = {
          ...cur,
          title: s.title,
          html: s.html,
          version: cur.version + 1,
          pinned: s.pinned ?? cur.pinned,
          app: s.app ?? cur.app,
          updated_at: ts,
        };
        const connect = s.connect ?? cur.connect ?? [];
        if (connect.length) next.connect = connect;
        else delete next.connect;
        run(
          qb
            .updateTable("surfaces")
            .set({
              title: next.title,
              html: next.html,
              version: next.version,
              pinned: Number(next.pinned),
              app: Number(next.app),
              connect: next.connect ? JSON.stringify(next.connect) : null,
              updated_at: ts,
            })
            .where("id", "=", cur.id),
        );
        emit(next);
        return next;
      }
      const created: Surface = {
        id: newId("srf"),
        name: s.name,
        title: s.title,
        html: s.html,
        version: 1,
        pinned: s.pinned ?? false,
        app: s.app ?? false,
        ...(s.project_id ? { project_id: s.project_id } : {}),
        ...(s.thread_id ? { thread_id: s.thread_id } : {}),
        created_by: s.created_by,
        updated_at: ts,
        ...(s.connect?.length ? { connect: s.connect } : {}),
      };
      run(
        qb.insertInto("surfaces").values({
          id: created.id,
          name: created.name,
          title: created.title,
          html: created.html,
          version: 1,
          pinned: Number(created.pinned),
          app: Number(created.app),
          project_id: created.project_id ?? null,
          thread_id: created.thread_id ?? null,
          created_by: created.created_by,
          updated_at: ts,
          connect: created.connect ? JSON.stringify(created.connect) : null,
        }),
      );
      emit(created);
      return created;
    },
    patch(id: string, p: { pinned?: boolean | undefined; app?: boolean | undefined }): SurfaceSummary | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const next = { ...cur, pinned: p.pinned ?? cur.pinned, app: p.app ?? cur.app, updated_at: now() };
      run(
        qb
          .updateTable("surfaces")
          .set({ pinned: Number(next.pinned), app: Number(next.app), updated_at: next.updated_at })
          .where("id", "=", cur.id),
      );
      emit(next);
      return summary(next);
    },
    /** Records where an installed artifact came from. */
    setOrigin(id: string, origin: ArtifactOrigin): void {
      run(
        qb
          .updateTable("surfaces")
          .set({ origin: JSON.stringify(origin) })
          .where("id", "=", id),
      );
    },
    /** Sets the keys of `patch` (null removes one) over the current state, or over nothing with `replace`. */
    setState(id: string, patch: SurfaceState, replace = false): SurfaceState | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const next: SurfaceState = replace ? {} : { ...cur.state };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete next[k];
        else next[k] = v;
      }
      const json = JSON.stringify(next);
      if (json.length > SURFACE_STATE_MAX)
        throw badRequest(`state would be ${json.length} characters; the most is ${SURFACE_STATE_MAX}`);
      run(
        qb
          .updateTable("surfaces")
          .set({ state: json === "{}" ? null : json })
          .where("id", "=", cur.id),
      );
      bus.emit({ type: "surface.state", surface_id: cur.id, state: next });
      return next;
    },
    share(id: string, shared: boolean): SurfaceSummary | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const token = shared ? (cur.share_path?.slice(3) ?? randomUUID().replaceAll("-", "")) : null;
      run(qb.updateTable("surfaces").set({ share_token: token }).where("id", "=", cur.id));
      const next = repo.get(cur.id) as Surface;
      emit(next);
      return summary(next);
    },
  };
  return repo;
}
