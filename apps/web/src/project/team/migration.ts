import { isInside } from "./migration-path.ts";

export function toggleMigrationPath(paths: string[], path: string, checked: boolean): string[] {
  const rest = paths.filter((p) => !isInside(path, p));
  return checked ? [...rest.filter((p) => !isInside(p, path)), path].sort() : rest;
}

export function migrationPathSelected(paths: string[], path: string): boolean {
  return paths.some((p) => isInside(p, path));
}

export function migrationBlocker(
  code: string,
): "busy" | "conflict" | "connection" | "files" | "pending" | "inheritance" | "unknown" {
  if (["active_run", "active_job", "active_memory_work", "active_source_work"].includes(code)) return "busy";
  if (["slug_conflict", "artifact_name_conflict", "definition_changed"].includes(code)) return "conflict";
  if (["flow_binding", "connected_chat", "group_chat", "cross_project_thread", "published_surface"].includes(code))
    return "connection";
  if (["missing_attachment", "project_skill_requires_selection"].includes(code)) return "files";
  if (code === "inherited_scope") return "inheritance";
  return code === "unfinished_migration" ? "pending" : "unknown";
}
