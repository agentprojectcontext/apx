// Side questions per chat (DECISIONS.md#d-215), in memory for this window: the panel open over the composer, its
// exchanges and its unsent words. A layout change (a phone's width) that remounts the composer finds them as they were;
// closing the panel lets them go, and an answer arriving after that is dropped.
import { useSyncExternalStore } from "react";
import { client } from "./client.ts";

/** One exchange of a side question, as its panel shows it. */
type AsideTurn = { question: string; answer: string };

export type Aside = {
  turns: AsideTurn[];
  /** The question waiting for its answer. */
  asking?: string;
  error?: string;
  /** What is typed in its field. */
  text: string;
};

const asides = new Map<string, Aside>();
const listeners = new Set<() => void>();

export function subscribeAside(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chat's open side question, or undefined when closed. */
export const asideOf = (thread: string): Aside | undefined => asides.get(thread);

function set(thread: string, next: Aside | undefined): void {
  if (next) asides.set(thread, next);
  else asides.delete(thread);
  for (const l of listeners) l();
}

export const openAside = (thread: string) => {
  if (!asides.has(thread)) set(thread, { turns: [], text: "" });
};
export const closeAside = (thread: string) => set(thread, undefined);
export const typeAside = (thread: string, text: string) => {
  const cur = asides.get(thread);
  if (cur) set(thread, { ...cur, text });
};

/** Asks the chat's agent apart from the chat; on failure the words go back to the field with the reason. */
export function askAside(thread: string, value: string): void {
  const cur = asides.get(thread);
  const question = value.trim();
  if (!cur || !question || cur.asking) return;
  set(thread, { turns: cur.turns, asking: question, text: "" });
  const { turns } = cur;
  const still = (next: Aside | undefined) => (next && next.asking === question ? next : undefined);
  client.call("threads.aside", { thread, question, ...(turns.length ? { earlier: turns } : {}) }).then(
    ({ answer }) => {
      const now = still(asides.get(thread));
      if (now) set(thread, { turns: [...now.turns, { question, answer }], text: now.text });
    },
    (e: unknown) => {
      const now = still(asides.get(thread));
      if (now)
        set(thread, {
          turns: now.turns,
          text: now.text || question,
          error: e instanceof Error ? e.message : String(e),
        });
    },
  );
}

/** Whether the chat's side question is open (the composer shows its panel). */
export const useAsideOpen = (thread: string) => useSyncExternalStore(subscribeAside, () => Boolean(asideOf(thread)));
