// What APX itself tells the owner about an agent's turn (not the agent's words), in the owner's language.
import path from "node:path";
import type { DeletionCard } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { isInside } from "../paths.ts";
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
  browser_steps: (a) =>
    `${a} quiere ejecutar pasos que pueden escribir en una web. Como leyó contenido de afuera, revisá qué va a mandar.`,
  mcp_outside: (a, t) =>
    `${a} quiere usar ${t} en un servicio conectado. Como leyó contenido de afuera, hace falta tu permiso para esa herramienta y cuenta: el acceso rápido por defecto no alcanza.`,
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
  browser_steps: (a) =>
    `${a} wants to run steps that can enter data on a website. Because the turn includes outside content, check what will be sent.`,
  mcp_outside: (a, t) =>
    `${a} wants to use ${t} in a connected service. The turn includes outside content, so default access is not enough: your permission must cover this tool and account.`,
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

/**
 * What a deletion card shows: what goes, one line each, with paths relative to the project; the agent's reason only
 * when it gave one; the command apart. `detail` is the same as one text, for a channel's message.
 */
export function deletionCard(
  store: Store,
  d: Deletion,
  why: string | undefined,
  command: string,
): { detail: string; deletion: DeletionCard } {
  const en = english(store);
  const items = deletionItems(d, en ? EN : ES);
  const reason = why?.trim() || undefined;
  const detail = [
    ...items,
    ...(reason ? ["", `${en ? "Why" : "Por qué"}: ${reason}`] : []),
    "",
    `${en ? "Command" : "Comando"}: ${command}`,
  ].join("\n");
  return { detail, deletion: { items, ...(reason ? { reason } : {}), command } };
}

type Words = {
  project: string;
  /** Up to this many names, then "and N more". */
  more: (n: number) => string;
  path: (p: string) => string;
  changes: (n: number, names: string, folder: string | undefined) => string;
  oneChange: (p: string) => string;
  later: (w: string) => string;
} & Record<Exclude<GitLoss["what"], "changes">, (t: string, soft: boolean) => string>;

const EN: Words = {
  project: "the project folder",
  more: (n) => `and ${n} more`,
  path: (p) => (p === "the project folder" ? "The project folder" : p),
  changes: (n, names, folder) => `Unsaved changes in ${n} files${folder ? ` in ${folder}` : ""} (${names})`,
  oneChange: (p) => `Unsaved changes in ${p}`,
  later: (w) => `Known only when it runs: ${w}`,
  branch: (t, soft) =>
    soft ? `The branch ${t} (git keeps it if its work is not merged)` : `The branch ${t}, even with work not merged`,
  worktree: (t, soft) =>
    soft
      ? `The work folder ${t} (git keeps it if it has unsaved changes)`
      : `The work folder ${t}, with its unsaved changes`,
  untracked: (t) => `Files git does not keep in ${t}`,
  stash: (t) => `The stash ${t}`,
  stashes: () => "Every stash",
  commits: () => "Commits that only git's history of moves still keeps",
};
const ES: Words = {
  project: "la carpeta del proyecto",
  more: (n) => `y ${n} más`,
  path: (p) => (p === "la carpeta del proyecto" ? "La carpeta del proyecto" : p),
  changes: (n, names, folder) => `Cambios sin guardar en ${n} archivos${folder ? ` de ${folder}` : ""} (${names})`,
  oneChange: (p) => `Cambios sin guardar en ${p}`,
  later: (w) => `Se sabe recién al correr: ${w}`,
  branch: (t, soft) =>
    soft
      ? `La rama ${t} (git no la borra si tiene trabajo sin mergear)`
      : `La rama ${t}, aunque tenga trabajo sin mergear`,
  worktree: (t, soft) =>
    soft
      ? `La carpeta de trabajo ${t} (git no la borra si tiene cambios sin guardar)`
      : `La carpeta de trabajo ${t}, con sus cambios sin guardar`,
  untracked: (t) => `Los archivos que git no guarda en ${t}`,
  stash: (t) => `El stash ${t}`,
  stashes: () => "Todos los stashes",
  commits: () => "Commits que solo guarda el historial de movimientos de git",
};

/** Names a card lists before "and N more". */
const NAMES = 6;

function deletionItems(d: Deletion, w: Words): string[] {
  // Inside the project a path shows relative to it, with `/`; outside, in full.
  const shown = (p: string) => {
    if (!d.root || !isInside(d.root, p)) return p;
    return path.relative(d.root, p).split(path.sep).join("/") || w.project;
  };
  const changed = d.git.filter((l) => l.what === "changes").map((l) => shown(l.target));
  return [
    ...d.paths.map((p) => w.path(shown(p))),
    ...(changed.length ? [changes(changed, w)] : []),
    ...d.git.flatMap((l) =>
      l.what === "changes"
        ? []
        : [w[l.what](l.what === "worktree" || l.what === "untracked" ? shown(l.target) : l.target, !!l.soft)],
    ),
    ...d.later.map(w.later),
  ];
}

/** Unsaved changes in one place, or in several files named from the folder they share. */
function changes(files: string[], w: Words): string {
  const [first] = files;
  if (files.length === 1 && first) return w.oneChange(first);
  const folders = files.map((f) => f.split("/").slice(0, -1));
  const shared: string[] = [];
  for (const part of folders[0] ?? []) {
    if (!folders.every((f) => f[shared.length] === part)) break;
    shared.push(part);
  }
  const names = files.map((f) => f.split("/").slice(shared.length).join("/"));
  const listed = names.slice(0, NAMES).join(", ");
  const rest = names.length > NAMES ? ` ${w.more(names.length - NAMES)}` : "";
  return w.changes(files.length, `${listed}${rest}`, shared.length ? shared.join("/") : undefined);
}
