import { Badge, Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import GraphDraft from "../flows/Draft.tsx";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { FlowDetail } from "./FlowDetail.tsx";
import { FlowEditor } from "./FlowEditor.tsx";
import { draftFlow, type Flow, type FlowDraft } from "./flow-form.ts";
import "./flows.css";

export default function FlowsPane({ projectId }: { projectId?: string | undefined }) {
  const projects = useData((s) => s.projects);
  const ready = usePack("flow");
  const t = useT();
  const [loaded, setLoaded] = useState<{ flows: Flow[]; revision: number }>();
  const flows = loaded?.flows;
  const [editing, setEditing] = useState<{ draft: FlowDraft; creating: boolean }>();
  const [selected, setSelected] = useState<string>();
  const [graphFlow, setGraphFlow] = useState<string>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    setError("");
    void client
      .call("flows.list", { project: projectId })
      .then((result) => {
        if (live) setLoaded({ flows: result.flows, revision });
      })
      .catch((e: unknown) => {
        if (live) setError(t("flow.failed", { error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      live = false;
    };
  }, [projectId, revision, t]);
  if (graphFlow && ready) return <GraphDraft key={graphFlow} flow={graphFlow} close={() => setGraphFlow(undefined)} />;
  if (!ready) return <Skeleton width="100%" height={80} />;
  return (
    <section className="page flows" aria-label={t("flow.title")}>
      <div className="flow-actions">
        <h1 className="page__title">{t("flow.title")}</h1>
        <label>
          {t("flow.projectFilter")}
          <select
            aria-label={t("flow.projectFilter")}
            value={projectId ?? ""}
            onChange={(e) => go.flows(e.currentTarget.value || undefined)}
          >
            <option value="">{t("flow.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="secondary" onClick={refresh}>
          {t("common.refresh")}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            setEditing({
              creating: true,
              draft: draftFlow({
                id: "",
                projectId: projectId ?? "",
                name: "",
                enabled: false,
                predicates: [],
                tableKey: "latest",
                action: { kind: "none" },
              }),
            })
          }
        >
          {t("flow.new")}
        </Button>
      </div>
      <p>{t("flow.lead")}</p>
      <Button size="sm" variant="secondary" onClick={() => go.config("devices")}>
        {t("flow.tokens")}
      </Button>
      {error && <p role="alert">{error}</p>}
      {loaded?.revision !== revision && !error && <Skeleton width="100%" height={80} />}
      {flows?.length === 0 && (
        <EmptyState icon={<Icons.Clock />}>{t(projectId ? "flow.empty" : "flow.emptyAll")}</EmptyState>
      )}
      <div className="flow-list">
        {flows?.map((flow) => (
          <div className="flow-item" key={flow.id}>
            <div className="flow-actions">
              <Button
                size="sm"
                variant={selected === flow.id ? "primary" : "secondary"}
                onClick={() => setSelected(selected === flow.id ? undefined : flow.id)}
              >
                {flow.name}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setGraphFlow(flow.id)}>
                {t("flow.graph.open")}
              </Button>
              <Badge>{t(flow.enabled ? "flow.enabled" : "flow.disabled")}</Badge>
              <span>{projects.find((p) => p.id === flow.projectId)?.name ?? flow.projectId}</span>
              <code>{flow.id}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing({ creating: false, draft: draftFlow(flow) })}
              >
                {t("flow.edit")}
              </Button>
            </div>
            <p>
              {t("flow.endpoint")}: <code>/flows/{flow.id}</code>
            </p>
            {selected === flow.id && <FlowDetail key={flow.id} flow={flow.id} />}
          </div>
        ))}
      </div>
      {editing && (
        <FlowEditor
          draft={editing.draft}
          creating={editing.creating}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
    </section>
  );
}
