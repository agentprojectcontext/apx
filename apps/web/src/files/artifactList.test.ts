import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurfaceSummary } from "@apx/protocol";
import { filterArtifacts } from "./artifactList.ts";

const art = (id: string, title: string, updated_at: string, project_id?: string): SurfaceSummary => ({
  id,
  name: id,
  title,
  version: 1,
  pinned: false,
  app: false,
  created_by: "owner",
  updated_at,
  ...(project_id ? { project_id } : {}),
});

const all = [
  art("ventas", "Estadísticas de ventas", "2026-10-02T10:00:00Z", "pr_acme"),
  art("clima", "Clima", "2026-10-03T10:00:00Z"),
  art("agenda", "Agenda", "2026-10-01T10:00:00Z", "pr_northwind"),
];
const ids = (list: SurfaceSummary[]) => list.map((s) => s.id);

test("artifacts are listed newest first, oldest first or by title", () => {
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "", order: "new" }, "~base")), [
    "clima",
    "ventas",
    "agenda",
  ]);
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "", order: "old" }, "~base")), [
    "agenda",
    "ventas",
    "clima",
  ]);
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "", order: "az" }, "~base")), [
    "agenda",
    "clima",
    "ventas",
  ]);
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "", order: "za" }, "~base")), [
    "ventas",
    "clima",
    "agenda",
  ]);
});

test("a project keeps its own artifacts, and the base project the ones with none", () => {
  assert.deepEqual(ids(filterArtifacts(all, { project: "pr_acme", query: "", order: "new" }, "~base")), ["ventas"]);
  assert.deepEqual(ids(filterArtifacts(all, { project: "~base", query: "", order: "new" }, "~base")), ["clima"]);
});

test("search finds an artifact by title without accents or case, or by its name", () => {
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "ESTADISTICAS", order: "new" }, "~base")), [
    "ventas",
  ]);
  assert.deepEqual(ids(filterArtifacts(all, { project: "", query: "agen", order: "new" }, "~base")), ["agenda"]);
  assert.deepEqual(filterArtifacts(all, { project: "", query: "nada", order: "new" }, "~base"), []);
});

test("filtering leaves the list it was given as it was", () => {
  const before = ids(all);
  filterArtifacts(all, { project: "", query: "", order: "az" }, "~base");
  assert.deepEqual(ids(all), before);
});
