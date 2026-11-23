// What APX itself tells the owner about an agent's turn (not the agent's words), in the owner's language.
import type { Store } from "../domain/store.ts";
import type { Deletion, GitLoss } from "../tools/command-deletions.ts";
import type { ConfirmWhy } from "../tools/policy.ts";

const es: Record<ConfirmWhy, (agent: string, tool: string) => string> = {
  untrusted: (a, t) =>
    `${a} quiere usar ${t}. Te pregunto porque en este turno hay contenido de afuera (una web, otro agente o un mensaje).`,
  always: (a, t) => `${a} quiere usar ${t}: es una acción de alto impacto y también requiere tu OK en modo Auto.`,
  kept: (a, t) => `${a} quiere usar ${t}: esto te pregunta siempre, en cualquier modo.`,
  needs_ok: (a, t) => `${a} necesita tu OK para usar ${t}.`,
  asks_every: (a, t) => `${a} quiere usar ${t}: pide tu OK antes de cada acción que cambia algo.`,
  rule: (a, t) => `${a} quiere usar ${t}: sus reglas piden tu OK para esta clase de acción.`,
  url_data: (a, t) =>
    `${a} quiere usar ${t} con una URL que lleva datos (lo que va después del «?»), y en este turno hay contenido de una web, otro agente o un mensaje. Mirá que no mande nada tuyo a otro sitio.`,
};

const en: typeof es = {
  untrusted: (a, t) =>
    `${a} wants to use ${t}. Asking because content from outside (a web page, another agent or a message) is in this turn.`,
  always: (a, t) => `${a} wants to use ${t}: this is a high-impact action and needs your OK even in Auto mode.`,
  kept: (a, t) => `${a} wants to use ${t}: this always asks you, in every mode.`,
  needs_ok: (a, t) => `${a} needs your OK to use ${t}.`,
  asks_every: (a, t) => `${a} wants to use ${t}: it asks before every action that changes something.`,
  rule: (a, t) => `${a} wants to use ${t}: its rules ask for your OK on this kind of action.`,
  url_data: (a, t) =>
    `${a} wants to use ${t} with a URL that carries data (what follows the "?"), and content from a web page, another agent or a message is in this turn. Check it sends nothing of yours to another site.`,
};

/** The question shown when an agent's action waits for the owner. */
export const confirmPrompt = (store: Store, why: ConfirmWhy, agent: string, tool: string) =>
  (store.settings.get("owner_language") === "en" ? en : es)[why](agent, tool);

/** The question of a card that already says the change in the owner's words (a setting, a Flow): no tool name. */
export const ownerCardPrompt = (store: Store, agent: string) =>
  store.settings.get("owner_language") === "en"
    ? `${agent} needs your OK for this:`
    : `${agent} necesita tu OK para esto:`;

/** The question of a folder card: an agent wants to read folders outside its own, or (`write`) change files there. */
export const folderPrompt = (store: Store, agent: string, folders: string[], write = false) => {
  const where = folders.join(", ");
  if (store.settings.get("owner_language") === "en")
    return write
      ? `${agent} wants to change files in ${where}, outside its project`
      : `${agent} wants to read ${where}`;
  return write ? `${agent} quiere cambiar archivos en ${where}, fuera de su proyecto` : `${agent} quiere leer ${where}`;
};

const english = (store: Store) => store.settings.get("owner_language") === "en";

/** A result turn that said nothing, even on its second try. */
export const droppedWords = (store: Store, from: string) =>
  english(store)
    ? `Did not act on ${from}'s result, even after a second try. Open the chat to go on.`
    : `No retomó el resultado de ${from}, ni en un segundo intento. Abrí el chat para seguir.`;

/** A task still open with nobody working on it, after APX asked its agent once to go on. */
export const stalledWords = (store: Store, agent: string) =>
  english(store)
    ? `Nobody is working on it: ${agent} was asked to go on and stopped again without closing it or saying what it waits for.`
    : `Nadie la está trabajando: se le pidió a ${agent} que siguiera y volvió a frenar sin cerrarla ni decir qué espera.`;

/** A deletion card's question: the owner decides on what is deleted, not on a command (DECISIONS.md#d-266). */
export const deletePrompt = (store: Store, agent: string) =>
  english(store)
    ? `${agent} wants to delete this. In Auto an agent deletes only when you ask:`
    : `${agent} quiere borrar esto. En Auto un agente solo borra cuando vos se lo pedís:`;

/** What a deletion card shows: each path, what only the running command knows, the agent's reason and the command. */
export function deletionDetail(store: Store, d: Deletion, why: string | undefined, command: string): string {
  const en = english(store);
  const lost = en ? GIT_LOSS_EN : GIT_LOSS_ES;
  return [
    ...d.paths,
    ...d.git.map((l) => lost[l.what](l.target)),
    ...d.later.map((w) => `${en ? "Known only when it runs" : "Se sabe recién al correr"}: ${w}`),
    "",
    `${en ? "Why, in its words" : "Por qué, en sus palabras"}: ${why?.trim() || (en ? "it did not say" : "no lo dijo")}`,
    `${en ? "Command" : "Comando"}: ${command}`,
  ].join("\n");
}

/** What a git command throws away, in the owner's words. */
const GIT_LOSS_EN: Record<GitLoss["what"], (t: string) => string> = {
  branch: (t) => `Branch ${t}, even with commits merged nowhere`,
  worktree: (t) => `Worktree ${t}, with its uncommitted changes`,
  untracked: (t) => `Files git does not keep in ${t}`,
  changes: (t) => `Uncommitted changes in ${t}`,
  stash: (t) => `Stash ${t}`,
  stashes: () => "Every stash",
  commits: () => "Commits that only git's history of moves still keeps",
};
const GIT_LOSS_ES: typeof GIT_LOSS_EN = {
  branch: (t) => `La rama ${t}, aunque tenga commits sin mergear`,
  worktree: (t) => `El worktree ${t}, con sus cambios sin commitear`,
  untracked: (t) => `Los archivos que git no guarda en ${t}`,
  changes: (t) => `Los cambios sin commitear en ${t}`,
  stash: (t) => `El stash ${t}`,
  stashes: () => "Todos los stashes",
  commits: () => "Commits que solo guarda el historial de movimientos de git",
};
