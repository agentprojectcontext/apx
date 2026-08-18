// Switching projects from the rail keeps you where you are: /p/8/agents → /p/12/agents.
// Only the first segment travels — deeper ids (agents/:slug) and query params
// (?task=, ?agent=, ?thread=) name rows that belong to the project you're leaving.
import type { ProjectEntry } from "../types/daemon";

// Sections that only exist on one side of the Base/project split. Carrying one
// across would land on a route the target doesn't render.
const BASE_ONLY = new Set(["workspaces", "models", "agent-defaults"]);
const PROJECT_ONLY = new Set(["docs", "files"]);

// Present on Base and on every project alike.
const SHARED = new Set([
  "agents", "memories", "skills", "artifacts",
  "chat", "sessions", "logs",
  "routines", "tasks", "commitments", "mcps", "integrations", "vars",
  "config", "telegram",
]);

/**
 * Where the rail should navigate when the user picks `target` — the same tab on
 * the new project when that tab exists there, its overview otherwise.
 */
export function switchProjectHref(
  pathname: string,
  target: Pick<ProjectEntry, "id" | "kind">,
): string {
  const to = `/p/${target.id}`;
  const match = pathname.match(/^\/p\/[^/]+(?:\/(.*))?$/);
  if (!match) return to; // not inside a project — nothing to carry
  const section = (match[1] || "").split("/")[0];
  if (!section) return to;

  const isBase = String(target.id) === "0";
  if (SHARED.has(section)) return `${to}/${section}`;
  if (BASE_ONLY.has(section)) return isBase ? `${to}/${section}` : to;
  if (PROJECT_ONLY.has(section)) return isBase ? to : `${to}/${section}`;
  // Structure is the org chart — company projects only.
  if (section === "structure") return !isBase && target.kind === "company" ? `${to}/${section}` : to;
  return to;
}
