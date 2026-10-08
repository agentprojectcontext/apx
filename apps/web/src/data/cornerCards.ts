// What the corner cards have already said on this device. Its own key, apart from the prefs: closing a card is not a
// preference anyone edits, and nothing else resets it.
import { createStore, useSlice } from "./createStore.ts";

type Closed = {
  discord: boolean;
  star: boolean;
  /** The version whose card was closed: skipping one release is not a decision about the next. */
  update: string;
};

const KEY = "apx.corner";

function load(): Closed {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Closed>;
    return {
      discord: raw.discord === true,
      star: raw.star === true,
      update: typeof raw.update === "string" ? raw.update : "",
    };
  } catch {
    return { discord: false, star: false, update: "" };
  }
}

const store = createStore<Closed>(load());

export const useClosedCards = <T>(select: (s: Closed) => T): T => useSlice(store, select);

export function closeCard(patch: Partial<Closed>): void {
  store.set(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(store.get()));
  } catch {
    // Storage blocked: closed for this session only.
  }
}
