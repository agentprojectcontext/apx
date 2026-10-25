// What the corner cards have already said on this device. Its own key, apart from the prefs: closing a card is not a
// preference anyone edits, and nothing else resets it. A closed update card is kept for this session only: an update
// left for later must show again when APX opens, or it is never seen.
import { createStore, useSlice } from "./createStore.ts";

type Closed = {
  discord: boolean;
  star: boolean;
  /** The version whose card was closed in this session: skipping one release is not a decision about the next. */
  update: string;
  /** "v1 is still running", closed for this session only. */
  v1: boolean;
  /** The welcome to v2 as the release, said once. */
  welcome: boolean;
};

const KEY = "apx.corner";

function load(): Closed {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Closed>;
    return {
      discord: raw.discord === true,
      star: raw.star === true,
      update: "",
      v1: false,
      welcome: raw.welcome === true,
    };
  } catch {
    return { discord: false, star: false, update: "", v1: false, welcome: false };
  }
}

const store = createStore<Closed>(load());

export const useClosedCards = <T>(select: (s: Closed) => T): T => useSlice(store, select);

export function closeCard(patch: Partial<Closed>): void {
  store.set(patch);
  try {
    const { discord, star, welcome } = store.get();
    localStorage.setItem(KEY, JSON.stringify({ discord, star, welcome }));
  } catch {
    // Storage blocked: closed for this session only.
  }
}
