import type { SharedOrder, SurfaceSummary } from "@apx/protocol";

/** Folds accents and case, so "estadisticas" finds "Estadísticas". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** `project` "" is every project; the base project goes by the `base` id given to filterArtifacts. */
export type ArtifactFilter = { project: string; query: string; order: SharedOrder };

const byTitle = (a: SurfaceSummary, b: SurfaceSummary) => a.title.localeCompare(b.title);
const byDate = (a: SurfaceSummary, b: SurfaceSummary) => a.updated_at.localeCompare(b.updated_at);
const SORT: Record<SharedOrder, (a: SurfaceSummary, b: SurfaceSummary) => number> = {
  new: (a, b) => byDate(b, a),
  old: byDate,
  az: byTitle,
  za: (a, b) => byTitle(b, a),
};

/** The artifacts a filter keeps (by project, and by title or name), in its order; `base` is the base project id. */
export function filterArtifacts(all: readonly SurfaceSummary[], f: ArtifactFilter, base: string): SurfaceSummary[] {
  const q = fold(f.query);
  return all
    .filter(
      (s) =>
        (!f.project || (s.project_id ?? base) === f.project) &&
        (!q || fold(s.title).includes(q) || fold(s.name).includes(q)),
    )
    .sort(SORT[f.order]);
}
