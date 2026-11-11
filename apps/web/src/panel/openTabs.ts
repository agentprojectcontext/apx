import { useEffect } from "react";
import { createStore, useSlice } from "../data/createStore.ts";

/** What each side-panel tool has open as tabs, per chat (`<tool>:<chat>`), in the order they were opened. */
const opened = createStore<Record<string, readonly string[]>>({});
const NONE: readonly string[] = [];

function openTab(key: string, id: string) {
  opened.set((s) => (s[key]?.includes(id) ? {} : { [key]: [...(s[key] ?? NONE), id] }));
}

/** Drops a tab; returns the ones left, so the caller can pick what to show next. */
export function closeTab(key: string, id: string): readonly string[] {
  const left = (opened.get()[key] ?? NONE).filter((x) => x !== id);
  opened.set({ [key]: left });
  return left;
}

/**
 * The tabs a tool has open, with the item it shows now (a deep link, a card in the chat, history) added as one: the
 * shown item always has a tab. `key` is undefined while there is no chat.
 */
export function useOpenTabs(key: string | undefined, shown: string | undefined): readonly string[] {
  const ids = useSlice(opened, (s) => (key ? (s[key] ?? NONE) : NONE));
  useEffect(() => {
    if (key && shown) openTab(key, shown);
  }, [key, shown]);
  return shown && !ids.includes(shown) ? [...ids, shown] : ids;
}
