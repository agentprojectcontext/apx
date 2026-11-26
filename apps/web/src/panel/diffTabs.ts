import { createStore, useSlice } from "../data/createStore.ts";
import type { ChangeRow } from "./change-records.ts";

/** The changed files each chat has open as tabs in Changes, in the order they were opened. */
const opened = createStore<Record<string, readonly ChangeRow[]>>({});
const NONE: readonly ChangeRow[] = [];

/** One change of one file: the same file changed in two turns opens two tabs. */
export const diffTabId = (r: ChangeRow) => `${r.message}:${r.part}:${r.cwd}:${r.file.path}`;

export function useDiffTabs(thread: string): readonly ChangeRow[] {
  return useSlice(opened, (s) => s[thread] ?? NONE);
}

/** Opens a tab, or refreshes the one already open (a folder's change read again). */
export function openDiffTab(thread: string, row: ChangeRow) {
  const id = diffTabId(row);
  opened.set((s) => {
    const rows = s[thread] ?? NONE;
    const at = rows.findIndex((r) => diffTabId(r) === id);
    return { [thread]: at < 0 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r)) };
  });
}

/** Drops a tab; returns the ones left, so the caller can pick what to show next. */
export function closeDiffTab(thread: string, id: string): readonly ChangeRow[] {
  const left = (opened.get()[thread] ?? NONE).filter((r) => diffTabId(r) !== id);
  opened.set({ [thread]: left });
  return left;
}
