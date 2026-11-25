// The owner hears once, in the app's tray, that a project's files moved from .apc/ to .agent/, or why they did not.
// See DECISIONS.md#d-273
import type { Store } from "../domain/store.ts";
import type { FolderOutcome } from "./folder.ts";

const REF = (project: string) => `agent-folder:${project}`;
/** When APX first moved one of this owner's projects: the news entry is told only to them. */
export const FOLDER_MOVED = "agent_folder_moved";

export function tellFolderMove(store: Store, project: { id: string; name: string }, outcome: FolderOutcome): void {
  if (!store.settings.get(FOLDER_MOVED)) store.settings.set(FOLDER_MOVED, new Date().toISOString());
  const en = store.settings.get("owner_language") === "en";
  const kept =
    outcome.state === "moved" && outcome.kept.length
      ? en
        ? " Its git worktrees stay in .apc/."
        : " Sus worktrees de git quedan en .apc/."
      : "";
  const why =
    outcome.state === "conflict"
      ? en
        ? `.agent/ already has other versions of ${outcome.conflicts.join(", ")}. Keep the one you want; APX tries again at the next start.`
        : `.agent/ ya tiene otras versiones de ${outcome.conflicts.join(", ")}. Quedate con la que quieras; APX prueba de nuevo en el próximo inicio.`
      : outcome.state === "failed"
        ? en
          ? `Not moved (${outcome.error}). It keeps working from .apc/ and tries again at the next start.`
          : `No se movió (${outcome.error}). Sigue funcionando desde .apc/ y prueba de nuevo en el próximo inicio.`
        : "";
  store.notifications.add({
    kind: "agent",
    level: outcome.state === "moved" ? "info" : "warn",
    ref: REF(project.id),
    title:
      outcome.state === "moved"
        ? en
          ? `${project.name}: agents moved to .agent/`
          : `${project.name}: agentes movidos a .agent/`
        : en
          ? `${project.name}: agents not moved`
          : `${project.name}: no se movieron los agentes`,
    body:
      outcome.state === "moved"
        ? en
          ? `Its agents and settings are now in .agent/ instead of .apc/. If the folder is in git, the change shows as a diff for you to commit.${kept}`
          : `Sus agentes y su configuración ahora están en .agent/ en vez de .apc/. Si la carpeta está en git, el cambio aparece como diff para que lo commitees.${kept}`
        : why,
  });
}
