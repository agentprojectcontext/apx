import { Badge, Button, Dialog, FlowStepTile, IconButton, Icons } from "@apx/ui";
import { useCallback, useMemo, useState } from "react";
import { effortLabel, modelOf, splitRef, useModels } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useKnown, whoOf } from "./data.ts";
import { type Cover, FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { stepDetail } from "./look.tsx";
import { nextSteps, stepFacts } from "./step-facts.ts";
import { chainOrder, type FlowGraph, type FlowNode, STEP, scheduleName } from "./steps.tsx";
import "@apx/ui/flow.css";
import "./editor.css";
import "./flow-viewer.css";

/** On a phone a chosen step's settings are a sheet over the bottom 60% of the canvas (flow-viewer.css). */
const cover: Cover = (w, h) => (w <= 640 ? { right: 0, bottom: h * 0.6 } : { right: 0, bottom: 0 });

/**
 * A Flow from a chat's card, large and only to look at: its drawing to pan and zoom, and beside it the steps in order
 * or the chosen step's settings in words. Changing it is the editor's.
 */
export function FlowViewer(props: {
  flowId: string;
  name: string;
  project: string;
  graph: FlowGraph;
  draft: boolean;
  fitKey: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { graph } = props;
  const agents = useData((s) => s.agents);
  const [selected, setSelected] = useState<string | null>(null);
  // A step chosen on the canvas or in the list is brought into view, beside or above its settings.
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const pick = useCallback((id: string | null) => {
    setSelected(id);
    if (id) setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
  }, []);
  const step = graph.nodes.find((n) => n.id === selected);
  const look = useCallback(
    (n: FlowNode): StepLook => ({ title: n.label, ...stepDetail(n, props.flowId, agents, [], t) }),
    [props.flowId, agents, t],
  );
  return (
    <Dialog
      bare
      size="xl"
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={props.name}
      closeLabel={t("common.close")}
      className="flowviewer"
    >
      <div className="fv">
        <header className="fv__head">
          <span className="flowcard__icon" aria-hidden="true">
            <Icons.GitBranch size={14} />
          </span>
          <span className="fv__text">
            <span className="fv__name">{props.name}</span>
            <span className="fv__project">{props.project}</span>
          </span>
          <Badge tone={props.draft ? "warning" : "brand"} dot>
            {t(props.draft ? "flow.card.draft" : "flow.card.published")}
          </Badge>
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={props.onEdit}>
            {t("flow.card.open")}
          </Button>
        </header>
        <div className={step ? "fv__body has-step" : "fv__body"}>
          <div className="fv__canvas">
            <FlowCanvas
              graph={graph}
              look={look}
              selected={selected}
              onSelect={setSelected}
              minimap={graph.nodes.length > 2}
              fitKey={`viewer:${props.fitKey}`}
              focus={{ request: focus, cover, card: false, onClick: pick }}
            />
          </div>
          <aside className="fv__side" aria-label={t(step ? "flow.ed.stepSettings" : "flow.ed.steps")}>
            {step ? (
              <StepSheet graph={graph} n={step} back={() => pick(null)} select={pick} />
            ) : (
              <Steps graph={graph} select={pick} />
            )}
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

function Steps({ graph, select }: { graph: FlowGraph; select: (id: string) => void }) {
  const t = useT();
  return (
    <div className="fv__steps">
      <div className="fe-ins__title">
        <h2>{t("flow.ed.steps")}</h2>
        <span>{t("flow.view.pick")}</span>
      </div>
      <div className="fe-order">
        {chainOrder(graph).map((s, i) => (
          <button key={s.id} type="button" className="fe-order__row" onClick={() => select(s.id)}>
            <span className="fe-order__i">{i + 1}</span>
            <FlowStepTile icon={STEP[s.kind].icon} tone={STEP[s.kind].tone} />
            <span className="fe-order__name">{s.label}</span>
          </button>
        ))}
        {!graph.nodes.length && <span className="fe-ins__muted">{t("flow.ed.noSteps")}</span>}
      </div>
    </div>
  );
}

/** The chosen step as the editor's card shows it, its settings read back instead of fields to change. */
function StepSheet({
  graph,
  n,
  back,
  select,
}: {
  graph: FlowGraph;
  n: FlowNode;
  back: () => void;
  select: (id: string) => void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const known = useKnown();
  const catalog = useModels((s) => s.catalog);
  const modelName = useCallback(
    (ref: string) => {
      const { engine, effort } = splitRef(ref);
      const name = modelOf(ref, catalog)?.name ?? catalog.find((e) => e.id === engine)?.label ?? ref;
      return effort ? `${name} · ${effortLabel(effort)}` : name;
    },
    [catalog],
  );
  const facts = useMemo(
    () =>
      stepFacts(
        n,
        {
          graph,
          who: (x) => whoOf(x, agents, [], t, known),
          modelName,
          scheduleName: (cron) => scheduleName(cron, t),
        },
        t,
      ),
    [n, graph, agents, known, modelName, t],
  );
  const next = nextSteps(graph, n, t);
  const meta = STEP[n.kind];
  return (
    <div className="fv__sheet">
      <div className="fv__sheethead">
        <IconButton size="sm" label={t("flow.view.back")} icon={<Icons.ArrowLeft size={14} />} onClick={back} />
        <h2 className="fv__title">{n.label || t(meta.label)}</h2>
      </div>
      <div className="fv__scroll">
        <div className="fe-ins__head">
          <FlowStepTile icon={meta.icon} tone={meta.tone} size="lg" />
          <div className="fe-ins__kind">
            <span>{t(meta.label)}</span>
            {meta.body && <span>{t(meta.body)}</span>}
          </div>
        </div>
        <dl className="fv__facts">
          {facts.map((f) => (
            <div key={`${f.label}:${f.value}`} className="fv__fact">
              <dt>{f.label}</dt>
              <dd className={f.code ? "is-code" : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {next.length > 0 && (
          <div className="fe-outs">
            <span className="fe-ins__label">{t("flow.ed.next")}</span>
            {next.map((e) => (
              <button key={`${e.id}:${e.when ?? ""}`} type="button" className="fv__next" onClick={() => select(e.id)}>
                {e.when && <span className="fv__when">{e.when}</span>}
                <span className="fv__nextname">{e.label}</span>
                <Icons.ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
