import type { Agent, Routine } from "@apx/protocol";
import type { FlowShapeResult } from "@apx/protocol/flow-shape";
import {
  AgentAvatar,
  Button,
  Field,
  FlowStepTile,
  IconButton,
  Icons,
  Input,
  SegmentedControl,
  Select,
  Textarea,
} from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { blobOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { chainOrder, dotted, type FlowGraph, type FlowNode, hookPath, STEP } from "./steps.tsx";

type T = ReturnType<typeof useT>;

/** Why the drawn flow does not run yet, in the person's words. */
function problemText(shape: FlowShapeResult, graph: FlowGraph, t: T): string | undefined {
  if (shape.ok) return undefined;
  const step = graph.nodes.find((n) => n.id === shape.problem.node)?.label ?? "";
  return t(`flow.problem.${shape.problem.code}` as MessageKey, { step });
}

/** The panel at the right: the chosen step's settings, or every step in order with how the flow runs. */
export function Inspector(props: {
  graph: FlowGraph;
  selected: FlowNode | undefined;
  flowId: string | undefined;
  projectId: string;
  agents: Agent[];
  routines: Routine[];
  shape: FlowShapeResult;
  update: (n: FlowNode) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  unlink: (source: string, target: string) => void;
}) {
  const t = useT();
  const { graph, selected: n } = props;
  if (!n) {
    const problem = problemText(props.shape, graph, t);
    return (
      <div className="fe-ins">
        <div className="fe-ins__title">
          <h2>{t("flow.ed.steps")}</h2>
          <span>{t("flow.ed.stepsHint")}</span>
        </div>
        <div className="fe-order">
          {chainOrder(graph).map((s, i) => (
            <button key={s.id} type="button" className="fe-order__row" onClick={() => props.select(s.id)}>
              <span className="fe-order__i">{i + 1}</span>
              <FlowStepTile icon={STEP[s.kind].icon} tone={STEP[s.kind].tone} />
              <span className="fe-order__name">{s.label}</span>
            </button>
          ))}
          {!graph.nodes.length && <span className="fe-ins__muted">{t("flow.ed.noSteps")}</span>}
        </div>
        {graph.nodes.length > 0 && (
          <div className={problem ? "fe-shape is-draft" : "fe-shape"}>
            {problem ? t("flow.ed.draftOnly", { reason: problem }) : t("flow.ed.runsAsDrawn")}
          </div>
        )}
      </div>
    );
  }
  const meta = STEP[n.kind];
  const outs = graph.edges.filter((e) => e.source === n.id);
  return (
    <div className="fe-ins">
      <div className="fe-ins__head">
        <FlowStepTile icon={meta.icon} tone={meta.tone} size="lg" />
        <div className="fe-ins__kind">
          <span>{t(meta.label)}</span>
          {meta.body && <span>{t(meta.body)}</span>}
        </div>
        <IconButton label={t("flow.ed.delete")} icon={<Icons.Trash2 size={14} />} onClick={() => props.remove(n.id)} />
      </div>
      <Field label={t("flow.ed.stepName")}>
        {(id) => (
          <Input
            id={id}
            value={n.label}
            maxLength={120}
            onChange={(e) => props.update({ ...n, label: e.target.value })}
          />
        )}
      </Field>
      <Fields {...props} n={n} />
      {outs.length > 0 && (
        <div className="fe-outs">
          <span className="fe-ins__label">{t("flow.ed.next")}</span>
          {outs.map((e) => (
            <div key={e.target} className="fe-outs__row">
              <span>{graph.nodes.find((x) => x.id === e.target)?.label}</span>
              <IconButton
                label={t("flow.ed.unlink")}
                icon={<Icons.X size={12} />}
                onClick={() => props.unlink(e.source, e.target)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Fields(props: Parameters<typeof Inspector>[0] & { n: FlowNode }) {
  const t = useT();
  const { n, update } = props;
  switch (n.kind) {
    case "webhook":
      return <HookFields flowId={props.flowId} />;
    case "condition": {
      const path = n.input.kind === "event" ? dotted(n.input.path) : "";
      const kind = typeof n.equals === "number" ? "number" : typeof n.equals === "boolean" ? "bool" : "text";
      return (
        <>
          <Field label={t("flow.f.field")} hint={t("flow.f.fieldHint")}>
            {(id) => (
              <Input
                id={id}
                value={path}
                className="fe-mono"
                onChange={(e) =>
                  update({
                    ...n,
                    input: {
                      kind: "event",
                      path: e.target.value
                        .split(".")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            )}
          </Field>
          <SegmentedControl
            size="sm"
            label={t("flow.f.type")}
            value={kind}
            onValueChange={(v) => update({ ...n, equals: v === "number" ? 0 : v === "bool" ? true : "" })}
            options={[
              { value: "text", label: t("flow.f.text") },
              { value: "number", label: t("flow.f.number") },
              { value: "bool", label: t("flow.f.bool") },
            ]}
          />
          {typeof n.equals === "boolean" ? (
            <SegmentedControl
              size="sm"
              label={t("flow.f.equals")}
              value={n.equals ? "yes" : "no"}
              onValueChange={(v) => update({ ...n, equals: v === "yes" })}
              options={[
                { value: "yes", label: t("flow.f.yes") },
                { value: "no", label: t("flow.f.no") },
              ]}
            />
          ) : (
            <Field label={t("flow.f.equals")}>
              {(id) => (
                <Input
                  id={id}
                  value={String(n.equals ?? "")}
                  inputMode={typeof n.equals === "number" ? "decimal" : undefined}
                  onChange={(e) =>
                    update({
                      ...n,
                      equals:
                        typeof n.equals === "number" ? Number(e.target.value.replace(",", ".")) || 0 : e.target.value,
                    })
                  }
                />
              )}
            </Field>
          )}
          <p className="fe-note">{t("flow.f.checkNote")}</p>
        </>
      );
    }
    case "table_read":
      return (
        <>
          <Field label={t("flow.f.keys")} hint={t("flow.f.keysHint")}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                className="fe-mono"
                value={n.keys.join("\n")}
                onChange={(e) => update({ ...n, keys: e.target.value.split("\n").slice(0, 16) })}
              />
            )}
          </Field>
          <p className="fe-note">{t("flow.f.readNote")}</p>
        </>
      );
    case "table_write":
      return (
        <>
          <Field label={t("flow.f.key")}>
            {(id) => (
              <Input
                id={id}
                value={n.key}
                maxLength={128}
                className="fe-mono"
                onChange={(e) => update({ ...n, key: e.target.value })}
              />
            )}
          </Field>
          <p className="fe-note">{t("flow.f.saveNote")}</p>
        </>
      );
    case "agent":
      return (
        <>
          <Field label={t("flow.f.agent")}>
            {() => (
              <Select
                label={t("flow.f.agent")}
                value={n.agent || null}
                placeholder={t("flow.f.choose")}
                onValueChange={(v) => update({ ...n, agent: v ?? "" })}
                options={props.agents.map((a) => ({
                  value: a.id,
                  label: a.name,
                  ...(a.role ? { hint: a.role } : {}),
                  icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={16} animated={false} />,
                }))}
              />
            )}
          </Field>
          <Field label={t("flow.f.task")}>
            {(id) => (
              <Textarea
                id={id}
                rows={7}
                maxLength={8000}
                value={n.prompt}
                onChange={(e) => update({ ...n, prompt: e.target.value })}
              />
            )}
          </Field>
          <p className="fe-note">{t("flow.f.agentNote")}</p>
        </>
      );
    case "routine":
      return (
        <>
          <Field label={t("flow.f.routine")}>
            {() =>
              props.routines.length ? (
                <Select
                  label={t("flow.f.routine")}
                  value={n.routine || null}
                  placeholder={t("flow.f.choose")}
                  onValueChange={(v) => update({ ...n, routine: v ?? "" })}
                  options={props.routines.map((r) => ({ value: r.id, label: r.name }))}
                />
              ) : (
                <span className="fe-ins__muted">{t("flow.f.noRoutines")}</span>
              )
            }
          </Field>
          <p className="fe-note">{t("flow.f.routineNote")}</p>
        </>
      );
    case "llm":
      return <p className="fe-note">{t("flow.f.llmNote")}</p>;
  }
}

function HookFields({ flowId }: { flowId: string | undefined }) {
  const t = useT();
  const [base, setBase] = useState<string | null>();
  useEffect(() => {
    let live = true;
    void client.call("webhooks.get", {}).then(
      (w) => live && setBase(w.url ?? null),
      () => live && setBase(null),
    );
    return () => {
      live = false;
    };
  }, []);
  const url = flowId && base ? `${base.replace(/\/$/, "")}${hookPath(flowId)}` : undefined;
  return (
    <>
      <div className="fe-copy">
        <span className="fe-ins__label">{t("flow.f.url")}</span>
        {url ? (
          <div className="fe-copy__box">
            <code>{url}</code>
            <IconButton
              label={t("flow.f.copy")}
              icon={<Icons.Copy size={14} />}
              onClick={() =>
                void navigator.clipboard.writeText(url).then(
                  () => notify(t("flow.f.copied"), "info"),
                  () => undefined,
                )
              }
            />
          </div>
        ) : (
          <span className="fe-ins__muted">{t(flowId ? "flow.f.urlNoAddress" : "flow.f.urlLater")}</span>
        )}
      </div>
      <Button variant="link" size="sm" className="fe-link" onClick={() => go.config("devices")}>
        {t("flow.f.hookNote")}
      </Button>
    </>
  );
}
