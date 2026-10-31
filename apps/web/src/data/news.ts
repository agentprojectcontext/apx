// What each APX release brought this owner: the Help menu's latest lines and the What's new dialog, from the same
// entries the super-agent tells (DECISIONS.md#d-182).
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";

import type { NewsItem } from "./newsModel.ts";

/** The entries there were the last time the menu opened on this device: what is newer gets the button's dot. */
const LOOKED_KEY = "apx.newsLooked";

function readLooked(): string[] | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LOOKED_KEY) ?? "null");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

type State = {
  entries: NewsItem[] | undefined;
  looked: string[] | null;
  /** The dialog: closed (null), every release ("all") or opened on one entry (its id). */
  open: string | null;
};

const store = createStore<State>({ entries: undefined, looked: readLooked(), open: null });

export const useNews = <T>(select: (s: State) => T): T => useSlice(store, select);

/** Read when the panel starts and each time the menu opens: the first read may come before the core answers. */
export async function loadNews(): Promise<void> {
  try {
    const { entries } = await client.call("system.news", {});
    store.set({ entries });
  } catch {
    // An older core without the field, or offline: the menu keeps its links.
  }
}

/** The menu was opened: what it lists now is known, and the dot goes away. */
export async function lookAtNews(): Promise<void> {
  await loadNews();
  const looked = (store.get().entries ?? []).map((e) => e.id);
  store.set({ looked });
  try {
    localStorage.setItem(LOOKED_KEY, JSON.stringify(looked));
  } catch {
    // Storage blocked: known for this session only.
  }
}

/** Opening reads them again: a release while the panel was open brings new ones. */
export function openNews(id = "all"): void {
  store.set({ open: id });
  void loadNews();
}
export const closeNews = (): void => store.set({ open: null });
