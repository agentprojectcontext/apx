import { useEffect, useState } from "react";
import type { FlowGraph, FlowGraphIssue } from "../../../../packages/protocol/src/flow-graph.ts";
import { client } from "../data/client.ts";
import { isKey, useT } from "../i18n/index.ts";
import { FlowGraphEditor } from "./FlowGraphEditor.tsx";

type Draft = { graph: FlowGraph; saved: string; version: number | null };
const drafts = new Map<string, Draft>();
const warn = (e: BeforeUnloadEvent) => {
  if ([...drafts.values()].some((draft) => JSON.stringify(draft.graph) !== draft.saved)) e.preventDefault();
};
window.addEventListener("beforeunload", warn);
const initial = (): FlowGraph => ({
  schemaVersion: 2,
  nodes: [{ id: "webhook", label: "Webhook", kind: "webhook" }],
  edges: [],
  layout: [{ node: "webhook", x: 40, y: 80 }],
});

export default function GraphDraft({ flow, close }: { flow: string; close: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft | null>(() => drafts.get(flow) ?? null);
  const [issues, setIssues] = useState<FlowGraphIssue[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const text = (key: string) => {
    const full = `flow.graph.${key}`;
    return isKey(full) ? t(full) : t("flow.graph.issue.unknown");
  };
  useEffect(() => {
    if (drafts.has(flow)) return;
    let live = true;
    client
      .call("flows.graph_get", { flow })
      .then((doc) => {
        if (!live) return;
        const graph = doc.draft ?? doc.published ?? initial();
        const next = { graph, saved: JSON.stringify(graph), version: doc.draftVersion };
        drafts.set(flow, next);
        setDraft(next);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [flow]);
  const dirty = draft !== null && JSON.stringify(draft.graph) !== draft.saved;
  const update = (next: Draft) => {
    drafts.set(flow, next);
    setDraft(next);
  };
  const exit = () => {
    if (dirty && !window.confirm(t("flow.graph.discard"))) return;
    drafts.delete(flow);
    close();
  };
  const validate = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    const snapshot = JSON.stringify(draft.graph);
    try {
      const result = await client.call("flows.validate", { flow, graph: draft.graph });
      if (JSON.stringify(drafts.get(flow)?.graph) === snapshot) setIssues(result.issues);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    const snapshot = JSON.stringify(draft.graph);
    try {
      const result = await client.call("flows.draft_save", {
        flow,
        expectedVersion: draft.version,
        graph: draft.graph,
      });
      const current = drafts.get(flow);
      if (current) update({ ...current, saved: snapshot, version: result.draftVersion });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="fg-draft" aria-label={t("flow.graph.editor")}>
      <button type="button" onClick={exit} disabled={busy}>
        {t("flow.graph.close")}
      </button>
      <p role="status">{dirty ? t("flow.graph.unsaved") : t("flow.graph.saved")}</p>
      {error && <p role="alert">{t("flow.failed", { error })}</p>}
      {draft && (
        <FlowGraphEditor
          graph={draft.graph}
          onChange={(graph) => {
            update({ ...draft, graph });
            setIssues(null);
          }}
          issues={issues}
          text={text}
          onValidate={() => void validate()}
          onSaveDraft={() => void save()}
          busy={busy}
        />
      )}
    </section>
  );
}
