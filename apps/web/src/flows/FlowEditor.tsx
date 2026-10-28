import { ApxError } from "@apx/protocol/client";
import { shapeOfGraph } from "@apx/protocol/flow-shape";
import { Button, Dialog, FlowStepTile, IconButton, Icons, Input, Popover, Select, Textarea } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { describeIssue, issueText, shownGraph } from "./data.ts";
import { FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { connectNodes, moveNode, newNode, removeNode } from "./graph-edit.ts";
import { Inspector } from "./Inspector.tsx";
import { stepDetail } from "./look.tsx";
import { STARTERS, type Starter, starterGraph } from "./starters.ts";
import { type Flow, type FlowGraph, type FlowNode, isSoon, PALETTE, STEP, type StepKind } from "./steps.tsx";
import "./editor.css";

const EMPTY: FlowGraph = { schemaVersion: 2, nodes: [], edges: [], layout: [] };
const slug = (name: string) =>
  `${
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "flow"
  }-${Math.random().toString(36).slice(2, 6)}`;

/** The step that keeps a graph from being saved, if a required setting is still blank. */
function blank(n: FlowNode): boolean {
  switch (n.kind) {
    case "condition":
      return n.input.kind === "event" && n.input.path.length === 0;
    case "table_read":
      return !n.keys.some((k) => k.trim());
    case "table_write":
      return !n.key.trim();
    case "agent":
      return !n.agent || !n.prompt.trim();
    case "routine":
      return !n.routine;
    case "llm":
      return !n.model || !n.prompt.trim();
    default:
      return false;
  }
}
/** Labels the graph schema needs, and blank lines left in key lists. */
const tidy = (g: FlowGraph, t: ReturnType<typeof useT>): FlowGraph => ({
  ...g,
  nodes: g.nodes.map((n) => {
    const label = n.label.trim() || t(STEP[n.kind].label);
    return n.kind === "table_read"
      ? { ...n, label, keys: n.keys.map((k) => k.trim()).filter(Boolean) }
      : { ...n, label };
  }),
});

/** The full-screen editor: step types at the left, the canvas, and the chosen step's settings at the right. */
export function FlowEditor({
  flow,
  starter,
  projectId: preset,
  onClose,
  onSaved,
}: {
  flow: Flow | undefined;
  starter: Starter | undefined;
  projectId: string | undefined;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const allAgents = useData((s) => s.agents);
  const allRoutines = useRoutines((s) => s.routines);
  const [name, setName] = useState(flow?.name ?? "");
  const [projectId, setProjectId] = useState(flow?.projectId ?? preset ?? "");
  const [graph, setGraph] = useState<FlowGraph | undefined>(flow ? undefined : undefined);
  const [saved, setSaved] = useState<string>("");
  const [version, setVersion] = useState<number | null>(null);
  // The revision new events run, once the flow runs a published drawing.
  const [published, setPublished] = useState<number | null>(null);
  // Why the drawing can't run, as the core checked it: null when it can, undefined before a check.
  const [problem, setProblem] = useState<string | null>();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [trial, setTrial] = useState<{ matches: boolean } | null>(null);
  // What the last save said, shown in the top bar until the next change.
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);
  // Load once: what the flow runs now, or its draft with your last changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the flow is loaded when the editor opens, not after each save
  useEffect(() => {
    let live = true;
    if (!flow) {
      const sec = Object.values(allAgents).find((a) => a.kind === "secretary");
      const g = starterGraph(starter ?? STARTERS.blank, t, sec?.id);
      setGraph(g);
      setSaved(JSON.stringify([g, flow, ""]));
      return;
    }
    void shownGraph(flow, t).then((s) => {
      if (!live) return;
      const g = s.draftPending && s.draft ? s.draft : s.graph;
      setGraph(g);
      setVersion(s.draftVersion);
      setPublished(s.publishedRevision);
      setSaved(JSON.stringify([g, flow.name]));
    });
    return () => {
      live = false;
    };
  }, []);
  const agents = useMemo(
    () => Object.values(allAgents).filter((a) => !a.project_id || a.project_id === projectId),
    [allAgents, projectId],
  );
  const routines = useMemo(
    () => allRoutines.filter((r) => r.project_id === projectId && r.schedule.kind === "manual"),
    [allRoutines, projectId],
  );
  const g = graph ?? EMPTY;
  const shape = useMemo(() => shapeOfGraph(g), [g]);
  // The core checks the drawing as it changes (its agents, routines and models in this project).
  useEffect(() => {
    if (!flow || !graph) return;
    let live = true;
    const timer = setTimeout(() => {
      if (graph.nodes.some(blank) || !graph.nodes.some((n) => n.kind === "webhook")) return setProblem(undefined);
      void client.call("flows.validate", { flow: flow.id, graph: tidy(graph, t) }).then(
        (r) => live && setProblem(r.issues[0] ? describeIssue(r.issues[0], graph, t) : null),
        () => live && setProblem(undefined),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [flow, graph, t]);
  const dirty = graph !== undefined && JSON.stringify(flow ? [g, name] : [g, flow, name]) !== saved;
  const change = (next: FlowGraph) => {
    setGraph(next);
    setTrial(null);
    setSaid(null);
  };
  const sel = g.nodes.find((n) => n.id === selected);

  const add = (kind: StepKind) => {
    let i = 1;
    while (g.nodes.some((n) => n.id === `${kind}-${i}`)) i++;
    const made = newNode(kind, `${kind}-${i}`, t(STEP[kind].label));
    // A new AI step starts with the super-agent; any agent of the crew can be chosen instead.
    const secretary = agents.find((a) => a.kind === "secretary");
    const node = made.kind === "agent" && secretary ? { ...made, agent: secretary.id } : made;
    const from = kind === "webhook" ? undefined : (sel ?? g.nodes.at(-1));
    const at = from ? g.layout.find((p) => p.node === from.id) : undefined;
    const below = g.layout.filter((p) => at && p.x === at.x + 280).length;
    let next: FlowGraph = {
      ...g,
      nodes: [...g.nodes, node],
      layout: [...g.layout, { node: node.id, x: at ? at.x + 280 : 0, y: at ? at.y + below * 120 : 0 }],
    };
    if (from) next = connectNodes(next, from.id, node.id);
    change(next);
    setSelected(node.id);
  };
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const base = { title: n.label || t(STEP[n.kind].label), ...stepDetail(n, flow?.id, allAgents, allRoutines) };
      if (!trial) return base;
      const reached = trial.matches || n.kind === "webhook" || n.kind === "condition";
      return {
        ...base,
        state: reached ? "ran" : "skipped",
        badge:
          n.kind === "condition"
            ? t(trial.matches ? "flow.log.yes" : "flow.log.no")
            : reached
              ? "ok"
              : t("flow.legend.stepSkipped"),
      };
    },
    [trial, flow?.id, allAgents, allRoutines, t],
  );

  const save = async () => {
    const missing = !name.trim()
      ? t("flow.ed.needName")
      : !projectId
        ? t("flow.ed.needProject")
        : !g.nodes.some((n) => n.kind === "webhook")
          ? t("flow.ed.needTrigger")
          : undefined;
    const incomplete = g.nodes.find(blank);
    if (missing || incomplete) {
      setSaid({
        error: true,
        text:
          missing ?? t("flow.ed.complete", { step: incomplete?.label || t(STEP[incomplete?.kind ?? "webhook"].label) }),
      });
      if (incomplete) setSelected(incomplete.id);
      return;
    }
    const clean = tidy(g, t);
    const result = shapeOfGraph(clean);
    const id = flow?.id ?? slug(name);
    // A flow that runs its old definition keeps it while the drawing stands for one (or gets one when new).
    const legacy = published === null && (result.ok || !flow);
    setBusy(true);
    try {
      if (legacy) {
        const s = result.ok
          ? result.shape
          : { predicates: [], readKeys: [], tableKey: "latest", action: { kind: "none" as const } };
        await client.call("flows.set", {
          id,
          projectId,
          name: name.trim(),
          enabled: flow?.enabled ?? false,
          predicates: s.predicates,
          tableKey: s.tableKey,
          action: s.action,
          ...(s.readKeys.length ? { readKeys: s.readKeys } : {}),
        });
      } else if (flow && name.trim() !== flow.name) await client.call("flows.set", { ...flow, name: name.trim() });
      const doc = await client.call("flows.draft_save", { flow: id, expectedVersion: version, graph: clean });
      let next = { version: doc.draftVersion, published: doc.publishedRevision };
      const { issues } = await client.call("flows.validate", { flow: id, graph: clean });
      const first = issues[0];
      let text: string;
      if (first) text = t("flow.ed.savedCant", { reason: describeIssue(first, clean, t) });
      else if (published === null && result.ok) text = t(flow?.enabled ? "flow.ed.savedRuns" : "flow.ed.savedOff");
      else if (flow?.enabled && doc.draft && doc.draftVersion !== null) {
        // On, a saved drawing runs: new events use it, events already received finish as they started.
        const out = await client.call("flows.publish", {
          flow: id,
          expectedDraftVersion: doc.draftVersion,
          expectedPublishedRevision: doc.publishedRevision,
        });
        next = { version: out.draftVersion, published: out.publishedRevision };
        text = t("flow.ed.savedPublished");
      } else text = t(flow?.enabled ? "flow.ed.savedRuns" : "flow.ed.savedOn");
      setVersion(next.version);
      setPublished(next.published);
      setProblem(first ? describeIssue(first, clean, t) : null);
      setGraph(clean);
      setSaved(JSON.stringify([clean, name]));
      setSaid({ text, ...(first ? { error: true } : {}) });
      if (first?.node) setSelected(first.node);
      onSaved(id);
    } catch (e) {
      setSaid({
        error: true,
        text:
          issueText(e, clean, t) ??
          t(e instanceof ApxError && e.code === "conflict" ? "flow.ed.conflict" : "flow.ed.saveFailed"),
      });
    } finally {
      setBusy(false);
    }
  };
  const close = () => (dirty ? setLeaving(true) : onClose());
  const hasTrigger = g.nodes.some((n) => n.kind === "webhook");
  const project = projects.find((p) => p.id === projectId);
  return (
    <div className="fe" role="dialog" aria-modal="true" aria-label={name || t("flow.ed.untitled")}>
      <header className="fe-top">
        <IconButton label={t("flow.ed.close")} icon={<Icons.X size={16} />} onClick={close} />
        <Input
          aria-label={t("flow.ed.name")}
          className="fe-top__name"
          placeholder={t("flow.ed.untitled")}
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setSaid(null);
          }}
        />
        {flow ? (
          <span className="fe-top__project">{project?.name ?? projectId}</span>
        ) : (
          <Select
            size="sm"
            label={t("flow.ed.project")}
            placeholder={t("flow.ed.chooseProject")}
            value={projectId || null}
            onValueChange={(v) => {
              setProjectId(v ?? "");
              setSaid(null);
            }}
            options={projects.filter((p) => p.registered !== false).map((p) => ({ value: p.id, label: p.name }))}
            className="fe-top__select"
          />
        )}
        {said && !busy ? (
          <span
            className={said.error ? "fe-top__status is-error" : "fe-top__status"}
            role={said.error ? "alert" : "status"}
          >
            {said.text}
          </span>
        ) : (
          <span className={dirty ? "fe-top__status is-dirty" : "fe-top__status"} role="status">
            {busy ? t("flow.ed.saving") : dirty || !flow ? t("flow.ed.unsaved") : t("flow.ed.saved")}
          </span>
        )}
        <span className="fe-top__spacer" />
        <TryRun
          graph={g}
          shape={shape}
          who={(id) => allAgents[id]?.name ?? allRoutines.find((r) => r.id === id)?.name ?? id}
          onResult={setTrial}
        />
        <Button disabled={busy || !graph} onClick={() => void save()}>
          {t("flow.ed.save")}
        </Button>
      </header>
      <div className="fe-body">
        <nav className="fe-pal" aria-label={t("flow.ed.palette")}>
          {PALETTE.map((group) => (
            <div key={group.group} className="fe-pal__group">
              <span className="fe-pal__label">{t(group.group)}</span>
              {group.kinds.map((kind) => {
                const soon = isSoon(kind);
                const taken = kind === "webhook" && hasTrigger;
                const meta = STEP[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    className="fe-pal__item"
                    disabled={soon || taken}
                    title={taken ? t("flow.ed.oneTrigger") : undefined}
                    aria-label={
                      soon ? `${t(meta.label)} · ${t("common.soon")}` : t("flow.ed.add", { kind: t(meta.label) })
                    }
                    onClick={() => !soon && !taken && add(kind as StepKind)}
                  >
                    <FlowStepTile icon={meta.icon} tone={meta.tone} size="lg" />
                    <span className="fe-pal__text">
                      <span className="fe-pal__name">
                        {t(meta.label)}
                        {soon && <span className="fe-pal__soon">{t("common.soon")}</span>}
                      </span>
                      {meta.body && <span className="fe-pal__body">{t(meta.body)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="fe-pal__hint">{t("flow.ed.paletteHint")}</p>
        </nav>
        <div className="fe-canvas">
          {graph && (
            <FlowCanvas
              graph={g}
              look={look}
              selected={selected}
              onSelect={setSelected}
              edit={{
                move: (id, x, y) => change(moveNode(g, id, x, y)),
                connect: (source, target, when) => change(connectNodes(g, source, target, when)),
              }}
              minimap={g.nodes.length > 0}
              fitKey={`${flow?.id ?? "new"}:${g.nodes.length ? "some" : "none"}`}
            />
          )}
          {graph && !g.nodes.length && (
            <div className="fe-blank">
              <FlowStepTile icon={<Icons.Plus />} size="lg" />
              <strong>{t("flow.ed.blankTitle")}</strong>
              <span>{t("flow.ed.blankBody")}</span>
            </div>
          )}
        </div>
        <aside className="fe-side">
          <Inspector
            graph={g}
            selected={sel}
            flowId={flow?.id}
            projectId={projectId}
            agents={agents}
            routines={routines}
            problem={problem}
            update={(n) => change({ ...g, nodes: g.nodes.map((x) => (x.id === n.id ? n : x)) })}
            remove={(id) => {
              change(removeNode(g, id));
              setSelected(null);
            }}
            select={setSelected}
            branch={(source, target, when) =>
              change({
                ...g,
                edges: g.edges.map((e) => (e.source === source && e.target === target ? { ...e, when } : e)),
              })
            }
            unlink={(source, target) =>
              change({ ...g, edges: g.edges.filter((e) => !(e.source === source && e.target === target)) })
            }
          />
        </aside>
      </div>
      <Dialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t("flow.ed.discardTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              {t("flow.ed.keep")}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t("flow.ed.discard")}
            </Button>
          </>
        }
      >
        {t("flow.ed.discardBody")}
      </Dialog>
    </div>
  );
}

function TryRun({
  graph,
  shape,
  who,
  onResult,
}: {
  graph: FlowGraph;
  shape: ReturnType<typeof shapeOfGraph>;
  who: (id: string) => string;
  onResult: (r: { matches: boolean } | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState('{\n  "type": "lead"\n}');
  const [answer, setAnswer] = useState("");
  const go = async () => {
    if (!shape.ok) return setAnswer(t("flow.ed.tryNeedsShape"));
    let data: unknown;
    try {
      data = JSON.parse(sample);
    } catch {
      return setAnswer(t("flow.ed.tryBadJson"));
    }
    try {
      const { matches } = await client.call("flows.try", { predicates: shape.shape.predicates, data });
      onResult({ matches });
      const a = shape.shape.action;
      const target = a.kind === "agent" ? who(a.agent) : a.kind === "routine" ? who(a.routine) : undefined;
      setAnswer(
        !matches
          ? t("flow.ed.tryStop")
          : target
            ? t("flow.ed.tryPassAction", { key: shape.shape.tableKey, who: target })
            : t("flow.ed.tryPass", { key: shape.shape.tableKey }),
      );
    } catch {
      setAnswer(t("flow.ed.tryFailed"));
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAnswer("");
      }}
      align="end"
      width={340}
      label={t("flow.ed.tryTitle")}
      trigger={
        <Button variant="secondary" leadingIcon={<Icons.Play size={14} />} disabled={!graph.nodes.length}>
          {t("flow.ed.try")}
        </Button>
      }
    >
      <div className="fe-try">
        <strong>{t("flow.ed.tryTitle")}</strong>
        <p>{t("flow.ed.tryHint")}</p>
        <Textarea
          aria-label={t("flow.ed.trySample")}
          rows={6}
          className="fe-mono"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <Button size="sm" onClick={() => void go()}>
          {t("flow.ed.tryGo")}
        </Button>
        {answer && (
          <p className="fe-try__answer" role="status">
            {answer}
          </p>
        )}
      </div>
    </Popover>
  );
}
