// What APX itself tells the owner about an agent's turn (not the agent's words), in the owner's language.
import type { Store } from "../domain/store.ts";
import type { ConfirmWhy } from "../tools/policy.ts";

const es: Record<ConfirmWhy, (agent: string, tool: string) => string> = {
  untrusted: (a, t) =>
    `${a} quiere usar ${t}. Te pregunto porque en este turno hay contenido de afuera (una web, otro agente o un mensaje).`,
  always: (a, t) => `${a} quiere usar ${t}: esta acción siempre necesita tu OK.`,
  needs_ok: (a, t) => `${a} necesita tu OK para usar ${t}.`,
  asks_every: (a, t) => `${a} quiere usar ${t}: pide tu OK antes de cada acción que cambia algo.`,
};

const en: typeof es = {
  untrusted: (a, t) =>
    `${a} wants to use ${t}. Asking because content from outside (a web page, another agent or a message) is in this turn.`,
  always: (a, t) => `${a} wants to use ${t}: this action always needs your OK.`,
  needs_ok: (a, t) => `${a} needs your OK to use ${t}.`,
  asks_every: (a, t) => `${a} wants to use ${t}: it asks before every action that changes something.`,
};

/** The question shown when an agent's action waits for the owner. */
export const confirmPrompt = (store: Store, why: ConfirmWhy, agent: string, tool: string) =>
  (store.settings.get("owner_language") === "en" ? en : es)[why](agent, tool);

/**
 * A model did not answer and the turn moves to the next one in its chain: which model had no room (named by the error
 * when APX's own loop walked its chain), why in a few words, and where it went. The whole error stays as the detail.
 */
export function fallbackNotice(store: Store, from: string | undefined, reason: string, to: string) {
  const named = /^((?:acp:)?[a-z0-9][\w.-]*\/[^\s:]+(?::[^\s:]+)?):\s*/i.exec(reason);
  const model = named?.[1] ?? from ?? "APX";
  const rest = named ? reason.slice(named[0].length) : reason;
  const status = /\bHTTP (\d{3})\b/.exec(rest)?.[1];
  const en = store.settings.get("owner_language") === "en";
  const why =
    status === "429"
      ? en
        ? "usage limit reached"
        : "llegó a su límite de uso"
      : status
        ? `HTTP ${status}`
        : rest.replace(/\s+/g, " ").slice(0, 80);
  const text = en
    ? `${model} has no capacity right now (${why}); trying ${to}.`
    : `${model} no tiene disponibilidad ahora (${why}); sigo con ${to}.`;
  return { text, vars: { model, why, to }, detail: reason };
}
