// What each APX release brought this owner: the Help menu's latest lines and the What's new dialog, from the same
// entries the super-agent tells (DECISIONS.md#d-182-news).
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";

import { type NewsItem, withRead } from "./newsModel.ts";

/** The entries the owner opened on this device: the others keep their dot in the menu, and the button its own. */
const READ_KEY = "apx.newsRead";

function loadRead(): string[] | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(READ_KEY) ?? "null");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

type State = {
  entries: NewsItem[] | undefined;
  read: string[] | null;
  /** The dialog: closed (null), every release ("all") or opened on one entry (its id). */
  open: string | null;
};

const store = createStore<State>({ entries: undefined, read: loadRead(), open: null });

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

/** Opening one entry reads it; opening every release reads them all. A release while the panel was open brings new ones. */
export function openNews(id = "all"): void {
  const { entries = [], read } = store.get();
  const next = withRead(entries, read, id === "all" ? entries.map((e) => e.id) : [id]);
  store.set({ open: id, read: next });
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: read for this session only.
  }
  void loadNews();
}
export const closeNews = (): void => store.set({ open: null });
