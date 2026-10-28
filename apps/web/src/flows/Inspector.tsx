import type { Agent, Routine } from "@apx/protocol";
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
import { forAgents, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { nextWhen } from "./run-view.ts";
import {
  chainOrder,
  dotted,
  type FlowBinding,
  type FlowGraph,
  type FlowNode,
  hookPath,
  presetOf,
  SCHEDULE_PRESETS,
  STEP,
} from "./steps.tsx";

/** What a step gives the next ones: the part of its result a later step receives. */
const RESULT: Partial<Record<FlowNode["kind"], string[]>> = {
  llm: ["text"],
  agent: ["text"],
  routine: ["text"],
  table_read: ["rows"],
  table_write: ["value"],
};
/** Steps whose result can reach `id`: every step on a path before it, except the trigger (that is the event). */
function earlier(graph: FlowGraph, id: string): FlowNode[] {
  const seen = new Set<string>();
  const todo = [id];
  while (todo.length) {
    const at = todo.pop();
    for (const e of graph.edges)
      if (e.target === at && !seen.has(e.source)) {
        seen.add(e.source);
        todo.push(e.source);
      }
  }
  return chainOrder(graph).filter((n) => seen.has(n.id) && RESULT[n.kind]);
}

/** The panel at the right: the chosen step's settings, or every step in order with how the flow runs. */
export function Inspector(props: {
  graph: FlowGraph;
  selected: FlowNode | undefined;
  flowId: string | undefined;
  projectId: string;
  agents: Agent[];
  routines: Routine[];
  /** Why the saved drawing can't run, when the core said so; undefined until it has been checked. */
  problem: string | null | undefined;
  update: (n: FlowNode) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  unlink: (source: string, target: string) => void;
  /** Moves a connection out of a check to its other branch. */
  branch: (source: string, target: string, when: "yes" | "no") => void;
}) {
  const t = useT();
  const { graph, selected: n } = props;
  if (!n) {
    const { problem } = props;
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
        {graph.nodes.length > 0 && problem !== undefined && (
          <div className={problem ? "fe-shape is-draft" : "fe-shape"}>
            {problem ? t("flow.ed.cantRun", { reason: problem }) : t("flow.ed.runsAsDrawn")}
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
              {n.kind === "condition" && (
                <button
                  type="button"
                  className={e.when === "no" ? "fe-outs__when is-no" : "fe-outs__when"}
                  aria-label={t(e.when === "no" ? "flow.ed.toYes" : "flow.ed.toNo", {
                    step: graph.nodes.find((x) => x.id === e.target)?.label ?? "",
                  })}
                  onClick={() => props.branch(e.source, e.target, e.when === "no" ? "yes" : "no")}
                >
                  {t(e.when === "no" ? "flow.f.no" : "flow.f.yes")}
                </button>
              )}
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
    case "schedule":
      return <ScheduleFields cron={n.cron} onCron={(cron) => update({ ...n, cron })} />;
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
          <p className="fe-note">{t("flow.f.branchNote")}</p>
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
          <InputPicker
            label={t("flow.f.saveWhat")}
            graph={props.graph}
            n={n}
            value={n.value}
            onChange={(value) => update({ ...n, value })}
          />
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
          <InputPicker
            label={t("flow.f.receives")}
            graph={props.graph}
            n={n}
            value={n.input}
            onChange={(input) => update({ ...n, input })}
          />
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
          <InputPicker
            label={t("flow.f.receives")}
            graph={props.graph}
            n={n}
            value={n.input}
            onChange={(input) => update({ ...n, input })}
          />
          <p className="fe-note">{t("flow.f.routineNote")}</p>
        </>
      );
    case "llm":
      return <ModelFields {...props} n={n} />;
  }
}

function ModelFields(props: Parameters<typeof Inspector>[0] & { n: Extract<FlowNode, { kind: "llm" }> }) {
  const t = useT();
  const { n, update } = props;
  const catalog = useModels((s) => s.catalog);
  // Only a model API the owner set up: one exact model, called once, never a CLI engine.
  const options = catalog
    .filter(forAgents)
    .flatMap((e) =>
      e.models.filter((m) => m.chat).map((m) => ({ value: `${e.id}/${m.id}`, label: m.name, hint: e.label })),
    );
  if (n.model && !options.some((o) => o.value === n.model)) options.push({ value: n.model, label: n.model, hint: "" });
  return (
    <>
      <Field label={t("flow.f.model")}>
        {() => (
          <Select
            label={t("flow.f.model")}
            value={n.model || null}
            placeholder={t("flow.f.choose")}
            onValueChange={(v) => update({ ...n, model: v ?? "" })}
            options={options}
          />
        )}
      </Field>
      <Field label={t("flow.f.task")}>
        {(id) => (
          <Textarea
            id={id}
            rows={6}
            maxLength={8000}
            value={n.prompt}
            onChange={(e) => update({ ...n, prompt: e.target.value })}
          />
        )}
      </Field>
      <InputPicker
        label={t("flow.f.receives")}
        graph={props.graph}
        n={n}
        value={n.input}
        onChange={(input) => update({ ...n, input })}
      />
      <p className="fe-note">{t("flow.f.llmNote")}</p>
    </>
  );
}

/** What a step receives: what arrived (all of it or one field), or the result of a step before it. */
function InputPicker({
  label,
  graph,
  n,
  value,
  onChange,
}: {
  label: string;
  graph: FlowGraph;
  n: FlowNode;
  value: FlowBinding;
  onChange: (b: FlowBinding) => void;
}) {
  const t = useT();
  const before = earlier(graph, n.id);
  const from = value.kind === "node" ? value.node : "event";
  return (
    <>
      <Field label={label}>
        {() => (
          <Select
            label={label}
            value={from}
            onValueChange={(v) => {
              const step = before.find((x) => x.id === v);
              onChange(
                step ? { kind: "node", node: step.id, path: RESULT[step.kind] ?? [] } : { kind: "event", path: [] },
              );
            }}
            options={[
              { value: "event", label: t("flow.f.fromEvent") },
              ...before.map((x) => ({ value: x.id, label: t("flow.f.fromStep", { step: x.label }) })),
            ]}
          />
        )}
      </Field>
      {value.kind === "event" && (
        <Field label={t("flow.f.part")} hint={t("flow.f.partHint")}>
          {(id) => (
            <Input
              id={id}
              value={dotted(value.path)}
              className="fe-mono"
              placeholder={t("flow.f.partAll")}
              onChange={(e) =>
                onChange({
                  kind: "event",
                  path: e.target.value
                    .split(".")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 16),
                })
              }
            />
          )}
        </Field>
      )}
    </>
  );
}

/** How often it runs: a preset by name or a cron, with the next times in words, in the owner's time zone. */
function ScheduleFields({ cron, onCron }: { cron: string; onCron: (cron: string) => void }) {
  const t = useT();
  const [next, setNext] = useState<{ next: string[]; time_zone: string; error: "invalid" | "too_often" | null }>();
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void client.call("flows.next_runs", { cron: cron.trim() || "-" }).then(
        (r) => live && setNext(r),
        () => live && setNext(undefined),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cron]);
  const preset = presetOf(cron);
  return (
    <>
      <div className="fe-presets">
        <span className="fe-ins__label">{t("flow.f.often")}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.f.often")}
          value={preset?.cron ?? ""}
          onValueChange={onCron}
          options={SCHEDULE_PRESETS.map((p) => ({ value: p.cron, label: t(p.label) }))}
        />
      </div>
      <Field label={t("flow.f.cron")} hint={t("flow.f.cronHint")}>
        {(id) => (
          <Input
            id={id}
            value={cron}
            maxLength={120}
            className="fe-mono"
            spellCheck={false}
            onChange={(e) => onCron(e.target.value)}
          />
        )}
      </Field>
      <div className="fe-next" aria-live="polite">
        <span className="fe-ins__label">{t("flow.f.nextRuns")}</span>
        {next?.error ? (
          <span className="fe-next__error">
            {t(next.error === "too_often" ? "flow.f.cronOften" : "flow.f.cronBad")}
          </span>
        ) : (
          next?.next.map((at) => <span key={at}>{nextWhen(at, next.time_zone, t)}</span>)
        )}
      </div>
      {next && <p className="fe-note">{t("flow.f.scheduleNote", { zone: next.time_zone })}</p>}
    </>
  );
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
