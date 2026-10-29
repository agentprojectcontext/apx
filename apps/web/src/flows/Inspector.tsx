import type { Agent, Routine } from "@apx/protocol";
import { switchTrigger } from "@apx/protocol/flow-edit";
import { Field, FlowStepTile, IconButton, Icons, Input, SegmentedControl, Select, Textarea } from "@apx/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { forAgents, useModels } from "../data/models.ts";
import { listSecrets } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { VariableDialog } from "../resources/VariablesTab.tsx";
import { AiFields, aiNote } from "./AiFields.tsx";
import { CaseFields } from "./CaseFields.tsx";
import { type Address, HookFields } from "./HookFields.tsx";
import { InputPicker } from "./InputPicker.tsx";
import { HttpFields, NotifyFields } from "./OutwardFields.tsx";
import { ScheduleFields } from "./ScheduleFields.tsx";
import { branchesOf, chainOrder, type FlowGraph, type FlowNode, STEP } from "./steps.tsx";
import { TableReadFields, TableWriteFields } from "./TableFields.tsx";
import type { Values } from "./Template.tsx";
import { useColumns } from "./tables-data.ts";
import { valueGroups } from "./values.ts";
import { CmdFields, JsFields, SqlFields, VarsFields } from "./WorkFields.tsx";

/**
 * What step `n`'s template fields can insert, by field: the project's secrets (and the owner's for every project) are
 * loaded once, and the secrets group offers to save a new one, through the same dialog as Resources.
 */
function useValues(graph: FlowGraph, n: FlowNode | undefined, projectId: string): [Values, ReactNode] {
  const t = useT();
  const [secrets, setSecrets] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loaded` asks again after a secret is saved
  useEffect(() => {
    let live = true;
    void listSecrets().then((list) => {
      if (live && list)
        setSecrets([...new Set(list.filter((s) => !s.project_id || s.project_id === projectId).map((s) => s.name))]);
    });
    return () => {
      live = false;
    };
  }, [projectId, loaded]);
  const columnsOf = useColumns(projectId || undefined);
  const action = { label: t("flow.v.saveSecret"), when: "secret://", onSelect: () => setAdding(true) };
  const values: Values = (field) =>
    n ? valueGroups(graph, n, field, secrets, t, (kind) => t(STEP[kind].label), action, columnsOf) : [];
  const dialog = adding && (
    <VariableDialog
      row={undefined}
      projectId={projectId || undefined}
      onClose={() => setAdding(false)}
      onSaved={() => {
        setAdding(false);
        setLoaded((x) => x + 1);
      }}
    />
  );
  return [values, dialog];
}

/** Steps that work with a project's agents, tables, routines or folder: before one is chosen, they say so. */
const NEEDS_PROJECT: Partial<Record<FlowNode["kind"], "flow.need.tables" | "flow.need.routines" | "flow.need.folder">> =
  {
    table_read: "flow.need.tables",
    table_write: "flow.need.tables",
    routine: "flow.need.routines",
    cmd: "flow.need.folder",
    sql: "flow.need.folder",
  };

/** Every step in order, to jump to one, and whether the flow runs as drawn. */
export function StepList(props: {
  graph: FlowGraph;
  /** Why the saved drawing can't run, when the core said so; undefined until it has been checked. */
  problem: string | null | undefined;
  select: (id: string) => void;
}) {
  const t = useT();
  const { graph, problem } = props;
  return (
    <div className="fe-list">
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

/** The chosen step's settings, in the card over the canvas. */
export function Inspector(props: {
  graph: FlowGraph;
  selected: FlowNode;
  /** The Flow's address, for the webhook step. */
  address: Address;
  projectId: string;
  agents: Agent[];
  routines: Routine[];
  update: (n: FlowNode) => void;
  unlink: (source: string, target: string) => void;
  /** Moves a connection out of a check to another of its ways out. */
  branch: (source: string, target: string, when: string) => void;
  /** Takes a case out of a check, and the connections that left by it. */
  removeCase: (check: string, id: string) => void;
  /** Opens a table in the Flows screen's Tables, asking first when the drawing has unsaved changes. */
  openTable: (table: string) => void;
}) {
  const t = useT();
  const { graph, selected: n } = props;
  const [values, dialog] = useValues(graph, n, props.projectId);
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
      <Fields {...props} n={n} values={values} />
      {dialog}
      {outs.length > 0 && (
        <div className="fe-outs">
          <span className="fe-ins__label">{t("flow.ed.next")}</span>
          {outs.map((e) => (
            <div key={e.target} className="fe-outs__row">
              {n.kind === "condition" && (
                <span className="fe-outs__when">
                  <Select
                    size="sm"
                    label={t("flow.ed.wayOut", { step: graph.nodes.find((x) => x.id === e.target)?.label ?? "" })}
                    value={e.when ?? "yes"}
                    onValueChange={(v) => v && props.branch(e.source, e.target, v)}
                    options={branchesOf(n, t).map((b) => ({ value: b.id, label: b.label }))}
                  />
                </span>
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

function Fields(props: Parameters<typeof Inspector>[0] & { n: FlowNode; values: Values }) {
  const t = useT();
  const { n, update } = props;
  const needs = NEEDS_PROJECT[n.kind];
  if (needs && !props.projectId) return <p className="fe-needs">{t(needs)}</p>;
  switch (n.kind) {
    case "webhook":
    case "schedule":
      return (
        <>
          <TriggerKind n={n} update={update} />
          {n.kind === "webhook" ? (
            <HookFields address={props.address} n={n} update={update} />
          ) : (
            <ScheduleFields cron={n.cron} onCron={(cron) => update({ ...n, cron })} />
          )}
        </>
      );
    case "condition":
      return <CaseFields n={n} update={update} values={props.values} removeCase={(id) => props.removeCase(n.id, id)} />;
    case "vars":
      return <VarsFields n={n} update={update} values={props.values} />;
    case "js":
      return (
        <>
          <JsFields n={n} update={update} />
          <InputPicker
            label={t("flow.f.receives")}
            graph={props.graph}
            n={n}
            value={n.input}
            onChange={(input) => update({ ...n, input })}
          />
          <p className="fe-note">{t("flow.f.jsNote", { step: n.id })}</p>
        </>
      );
    case "sql":
      return <SqlFields n={n} update={update} values={props.values} />;
    case "cmd":
      return <CmdFields n={n} update={update} values={props.values} projectId={props.projectId} />;
    case "table_read":
      return (
        <TableReadFields
          n={n}
          projectId={props.projectId}
          values={props.values}
          update={update}
          openTable={props.openTable}
        />
      );
    case "table_write":
      return (
        <TableWriteFields
          n={n}
          graph={props.graph}
          projectId={props.projectId}
          values={props.values}
          update={update}
          openTable={props.openTable}
        />
      );
    case "agent":
      return (
        <>
          <AiFields
            n={n}
            update={update}
            agents={props.agents}
            projectId={props.projectId}
            receives={
              <InputPicker
                label={t("flow.f.receives")}
                graph={props.graph}
                n={n}
                value={n.input}
                onChange={(input) => update({ ...n, input })}
              />
            }
          />
          <p className="fe-note">{t(aiNote(n))}</p>
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
    case "notify":
      return <NotifyFields n={n} update={update} values={props.values} />;
    case "http":
      return <HttpFields n={n} update={update} values={props.values} />;
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

/**
 * What starts the Flow, switched in place: the step keeps its connections, and a name still the default follows the
 * new kind.
 */
function TriggerKind({
  n,
  update,
}: {
  n: Extract<FlowNode, { kind: "webhook" | "schedule" }>;
  update: (n: FlowNode) => void;
}) {
  const t = useT();
  return (
    <div className="trg-row">
      <span className="fe-ins__label">{t("flow.trig.startsWith")}</span>
      <SegmentedControl
        size="sm"
        label={t("flow.trig.startsWith")}
        value={n.kind}
        onValueChange={(kind) => {
          if (kind === n.kind) return;
          const other = kind as "webhook" | "schedule";
          update(switchTrigger(n, n.label === t(STEP[n.kind].label) ? t(STEP[other].label) : n.label));
        }}
        options={[
          { value: "webhook", label: t("flow.trig.webhook"), icon: <Icons.Zap size={14} /> },
          { value: "schedule", label: t("flow.trig.schedule"), icon: <Icons.Clock size={14} /> },
        ]}
      />
    </div>
  );
}
