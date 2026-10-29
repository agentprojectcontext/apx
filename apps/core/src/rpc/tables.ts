// A project's tables (DECISIONS.md#d-176): the owner's Tables on the Flows screen and the editor, and their agents'
// own tool calls (apx_flow), each kept to the projects it reaches as for Flows (DECISIONS.md#d-174).
import { FlowCapacityError } from "../domain/flow-events.ts";
import { FlowTableConflict, FlowTableMissing, FlowTableRequired } from "../domain/flow-tables.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound } from "../errors.ts";
import { flowReach } from "./flow-graphs.ts";
import type { Handlers } from "./router.ts";

export function tableHandlers(store: Store) {
  const reach = flowReach(store, "Project");
  const project = (ctx: Parameters<typeof reach>[0], id: string) => {
    reach(ctx, id);
    if (!store.projects.get(id)) throw notFound("Project");
    return id;
  };
  /** A repository change, with its refusals in the caller's words. */
  const change = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof CallError) throw error;
      if (error instanceof FlowTableMissing) throw notFound(error.message);
      if (error instanceof FlowTableConflict) throw conflict(error.message);
      if (error instanceof FlowCapacityError) throw badRequest(error.message);
      if (error instanceof FlowTableRequired) throw badRequest(error.message, { columns: error.columns });
      throw badRequest(error instanceof Error ? error.message : "Invalid table change");
    }
  };
  const tables = store.flowTables;
  return {
    "tables.list": (p, ctx) => {
      const kept = reach(ctx, p.project);
      if (p.project !== undefined && !store.projects.get(p.project)) throw notFound("Project");
      return { tables: tables.list(p.project ?? kept) };
    },
    "tables.get": (p, ctx) => {
      const table = change(() => {
        const t = tables.get(project(ctx, p.project), p.table);
        if (!t) throw new FlowTableMissing("Table");
        return t;
      });
      const rows = tables.latest(p.project, p.table, p.limit + 1, p.cursor);
      const page = rows.slice(0, p.limit);
      const last = page.at(-1);
      return { table, rows: page, nextCursor: rows.length > p.limit && last ? `${last.updated_at}|${last.key}` : null };
    },
    "tables.create": (p, ctx) => ({
      table: change(() => tables.create(project(ctx, p.project), p.name, p.columns)),
    }),
    "tables.rename": (p, ctx) => ({ table: change(() => tables.rename(project(ctx, p.project), p.table, p.name)) }),
    "tables.remove": (p, ctx) => ({ removed: tables.remove(project(ctx, p.project), p.table) }),
    "tables.column_add": (p, ctx) => ({
      table: change(() => tables.addColumn(project(ctx, p.project), p.table, p.column)),
    }),
    "tables.column_rename": (p, ctx) => ({
      table: change(() => tables.renameColumn(project(ctx, p.project), p.table, p.column, p.name)),
    }),
    "tables.column_required": (p, ctx) => ({
      table: change(() => tables.requireColumn(project(ctx, p.project), p.table, p.column, p.required)),
    }),
    "tables.column_remove": (p, ctx) => ({
      table: change(() => tables.removeColumn(project(ctx, p.project), p.table, p.column)),
    }),
    "tables.write": (p, ctx) => ({
      row: change(() => tables.write(project(ctx, p.project), p.table, p.key, p.values, { merge: p.replace !== true })),
    }),
    "tables.delete_rows": (p, ctx) => ({
      deleted: change(() => tables.deleteRows(project(ctx, p.project), p.table, p.keys)),
    }),
  } satisfies Partial<Handlers>;
}
