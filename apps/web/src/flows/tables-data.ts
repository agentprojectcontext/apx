// A project's tables (tables.*), read once per project and again after every change made here, shared by the editor's
// Read and Save steps, the `{}` picker and the Flows screen's Tables (DECISIONS.md#d-176).
import type { TableInfo } from "@apx/protocol";
import { useEffect } from "react";
import { client } from "../data/client.ts";
import { createStore, useSlice } from "../data/createStore.ts";

type State = { byProject: Record<string, TableInfo[] | undefined> };
const store = createStore<State>({ byProject: {} });

const loading = new Map<string, Promise<TableInfo[]>>();
/** Reads a project's tables again (one read at a time per project); the list stays as it was when it fails. */
export function loadTables(project: string): Promise<TableInfo[]> {
  const going = loading.get(project);
  if (going) return going;
  const next = client
    .call("tables.list", { project })
    .then(({ tables }) => {
      store.set((s) => ({ byProject: { ...s.byProject, [project]: tables } }));
      return tables;
    })
    .finally(() => loading.delete(project));
  loading.set(project, next);
  return next;
}

/** A project's tables, newest change first; undefined while they first load. Read again whenever it is shown. */
export function useTables(project: string | undefined): TableInfo[] | undefined {
  const tables = useSlice(store, (s) => (project ? s.byProject[project] : undefined));
  useEffect(() => {
    if (project) void loadTables(project).catch(() => undefined);
  }, [project]);
  return tables;
}

/** A table's columns by its name, for the `{}` picker of later steps. */
export function useColumns(project: string | undefined): (table: string) => readonly string[] {
  const tables = useTables(project);
  return (table) => tables?.find((t) => t.name === table)?.columns ?? [];
}

/** Each change answers with the table as it is now; the project's list is read again. */
const changed = async <T>(project: string, call: Promise<T>): Promise<T> => {
  const out = await call;
  await loadTables(project).catch(() => undefined);
  return out;
};

export const createTable = (project: string, name: string, columns?: string[]) =>
  changed(project, client.call("tables.create", { project, name, ...(columns ? { columns } : {}) }));
export const renameTable = (project: string, table: string, name: string) =>
  changed(project, client.call("tables.rename", { project, table, name }));
export const removeTable = (project: string, table: string) =>
  changed(project, client.call("tables.remove", { project, table }));
export const addColumn = (project: string, table: string, column: string) =>
  changed(project, client.call("tables.column_add", { project, table, column }));
export const renameColumn = (project: string, table: string, column: string, name: string) =>
  changed(project, client.call("tables.column_rename", { project, table, column, name }));
export const removeColumn = (project: string, table: string, column: string) =>
  changed(project, client.call("tables.column_remove", { project, table, column }));
export const writeRow = (project: string, table: string, key: string, values: Record<string, unknown>) =>
  changed(project, client.call("tables.write", { project, table, key, values }));
export const deleteRows = (project: string, table: string, keys: string[]) =>
  changed(project, client.call("tables.delete_rows", { project, table, keys }));
export const readTable = (project: string, table: string, limit = 200) =>
  client.call("tables.get", { project, table, limit });

/** A column's name as people type it, made one the core takes: no accents, `_` for anything else. */
export const columnName = (typed: string) =>
  typed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^-+/, "")
    .slice(0, 64);
/** Names a read gives besides its columns. */
export const RESERVED_COLUMNS: ReadonlySet<string> = new Set(["rows", "row"]);
