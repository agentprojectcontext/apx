import type { FlowHistoryEntry } from "../../../../packages/protocol/src/flow-history.ts";
import type { MessageKey } from "../i18n/index.ts";

export type HistoryEntry = FlowHistoryEntry;
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** What a save was: a draft saved, published, or brought back from an earlier one. */
export const kindLabel = (e: HistoryEntry, t: T) =>
  e.kind === "restored"
    ? t("flow.hist.restored", { from: e.restoredFrom ?? "" })
    : t(e.kind === "published" ? "flow.hist.published" : "flow.hist.draft");

/** Who saved it: the owner (who also brings versions back), or the agent that drew it. */
export const whoSaved = (e: HistoryEntry, t: T) =>
  e.kind === "restored" || !e.by ? t("flow.hist.you") : (e.byName ?? t("flow.hist.agent"));

/** The canvas's label for a version: "Version #3 · 14:02 · You"; `when` as the page writes times. */
export const entryLabel = (e: HistoryEntry, t: T, when: string) =>
  t("flow.hist.label", { n: e.entry, when, who: whoSaved(e, t) });
