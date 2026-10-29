import type { Result } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { Badge, Button, Dialog, IconButton, Icons, Popover, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useFlowDraft } from "../data/flowDrafts.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { type HistoryEntry, kindLabel, whoSaved } from "./history.ts";
import { runWhen } from "./run-view.ts";
import type { FlowGraph } from "./steps.tsx";

export type { HistoryEntry };

type Doc = Result<"flows.history_restore">;
/** A version picked from the history, drawn read-only. */
export type Looked = { entry: HistoryEntry; graph: FlowGraph };

/** A Flow's saved versions, newest first, read again whenever its drawing changes; undefined while loading. */
export function useFlowHistory(flow: string | undefined, open = true): HistoryEntry[] | undefined {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const drawn = useFlowDraft(flow ?? "");
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed drawing is read again
  useEffect(() => {
    if (!flow || !open) return;
    let live = true;
    void client.call("flows.history", { flow }).then(
      (r) => live && setEntries(r.entries),
      () => live && setEntries([]),
    );
    return () => {
      live = false;
    };
  }, [flow, open, drawn]);
  return flow ? entries : [];
}

/** One version's drawing. */
export const loadVersion = async (flow: string, entry: number): Promise<Looked> => {
  const r = await client.call("flows.history_get", { flow, entry });
  return { entry: r.entry, graph: r.graph };
};

/** The list of versions: when, what it was, who, and its steps; the one that runs now is marked. */
export function HistoryList({
  entries,
  selected,
  running,
  onPick,
}: {
  entries: HistoryEntry[] | undefined;
  selected?: number | undefined;
  running: number | null;
  onPick: (entry: HistoryEntry) => void;
}) {
  const t = useT();
  if (!entries) return <Skeleton width="100%" height={120} />;
  if (!entries.length) return <p className="fd__none">{t("flow.hist.none")}</p>;
  return (
    <>
      {entries.map((e) => (
        <button
          key={e.entry}
          type="button"
          className={e.entry === selected ? "fd__run fd__ver is-on" : "fd__run fd__ver"}
          aria-current={e.entry === selected}
          onClick={() => onPick(e)}
        >
          <span className="fd__runwhen">
            <span className={`fd__runmark is-${e.kind === "published" ? "ok" : "cut"}`} />#{e.entry}
          </span>
          <span className="fd__vertext">
            <strong>{kindLabel(e, t)}</strong>
            <span>
              {runWhen(e.at)} · {whoSaved(e, t)} · {t("flow.steps", { count: e.steps })}
            </span>
          </span>
          {running !== null && e.revision === running ? <Badge tone="brand">{t("flow.hist.runs")}</Badge> : <span />}
          <Icons.ChevronRight size={14} aria-hidden="true" />
        </button>
      ))}
    </>
  );
}

/**
 * Asks before a version becomes the draft, then brings it back: what runs never changes here, the owner's Save in the
 * editor does that (DECISIONS.md#d-179). `version`: the draft version the caller last read.
 */
export function RestoreDialog({
  flow,
  entry,
  version,
  unsaved,
  onClose,
  onRestored,
}: {
  flow: string | undefined;
  entry: HistoryEntry | undefined;
  version: () => Promise<number | null> | number | null;
  unsaved?: boolean;
  onClose: () => void;
  onRestored: (doc: Doc, entry: HistoryEntry) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    if (!flow || !entry) return;
    setBusy(true);
    try {
      const doc = await client.call("flows.history_restore", {
        flow,
        entry: entry.entry,
        expectedVersion: await version(),
        confirm: true,
      });
      notify(t("flow.hist.done", { n: entry.entry }), "info");
      onRestored(doc, entry);
      onClose();
    } catch (e) {
      notify(t(e instanceof ApxError && e.code === "conflict" ? "flow.ed.conflict" : "flow.hist.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(entry)}
      onOpenChange={(o) => !o && onClose()}
      title={t("flow.hist.confirmTitle", { n: entry?.entry ?? "" })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} leadingIcon={<Icons.RotateCcw size={14} />} onClick={() => void restore()}>
            {t("flow.hist.restore")}
          </Button>
        </>
      }
    >
      {t("flow.hist.confirmBody")}
      {unsaved ? ` ${t("flow.hist.confirmUnsaved")}` : ""}
    </Dialog>
  );
}

/** The editor's history: a button in its top bar opening the list; picking a version asks to restore it. */
export function EditorHistory({
  flow,
  running,
  version,
  unsaved,
  disabled,
  onRestored,
}: {
  flow: string | undefined;
  running: number | null;
  version: number | null;
  unsaved: boolean;
  disabled: boolean;
  onRestored: (doc: Doc) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<HistoryEntry>();
  const entries = useFlowHistory(flow, open);
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={340}
        label={t("flow.hist.tab")}
        trigger={
          <IconButton
            className="fe-top__history"
            label={t("flow.hist.tab")}
            icon={<Icons.History size={16} />}
            disabled={disabled || !flow}
          />
        }
      >
        <div className="fe-hist">
          <strong>{t("flow.hist.tab")}</strong>
          <p>{t("flow.hist.editorHint")}</p>
          <div className="fe-hist__list">
            <HistoryList
              entries={entries}
              running={running}
              onPick={(e) => {
                setOpen(false);
                setAsking(e);
              }}
            />
          </div>
        </div>
      </Popover>
      <RestoreDialog
        flow={flow}
        entry={asking}
        version={() => version}
        unsaved={unsaved}
        onClose={() => setAsking(undefined)}
        onRestored={(doc) => onRestored(doc)}
      />
    </>
  );
}
