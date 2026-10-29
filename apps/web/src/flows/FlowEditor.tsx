import type { Result } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { flowCases } from "@apx/protocol/flow-cases";
import { shapeOfGraph } from "@apx/protocol/flow-shape";
import { Button, Dialog, FlowStepTile, IconButton, Icons, Input, Popover, Select, Textarea } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer } from "../common/Drawer.tsx";
import { client } from "../data/client.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useDesktopClass } from "../shell/desktop.ts";
import { describeIssue, issueText, shownGraph, useKnown } from "./data.ts";
import { type Cover, FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { connectNodes, insertBefore, moveNode, newNode, removeCase, removeNode } from "./graph-edit.ts";
import { Inspector, StepList } from "./Inspector.tsx";
import { stepDetail } from "./look.tsx";
import { approveOutward } from "./outward.tsx";
import { STARTERS, type Starter, starterGraph } from "./starters.ts";
import {
  branchesOf,
  branchName,
  type Flow,
  type FlowGraph,
  type FlowNode,
  isTrigger,
  PALETTE,
  STEP,
  type StepKind,
  triggerOf,
} from "./steps.tsx";
import { ownTable, savedTableBefore } from "./values.ts";
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
    case "condition": {
      const cases = flowCases(n);
      return (
        cases.some((c) => c.match.kind === "expr" && !c.match.expr.trim()) ||
        (cases.some((c) => c.match.kind === "equals") && n.input.kind === "event" && n.input.path.length === 0)
      );
    }
    case "vars":
      return n.vars.some((v) => !v.name || (v.value.kind === "expr" && !v.value.expr.trim()));
    case "js":
      return !n.code.trim();
    case "sql":
      return !n.database.trim() || !n.query.trim();
    case "cmd":
      return !n.command.trim();
    case "table_read":
      return (!n.table && !ownTable(n)) || (n.latest === undefined && !n.keys.some((k) => k.trim()));
    case "table_write":
      return (!n.table && !ownTable(n)) || !n.key.trim();
    case "agent":
      return (n.bot ? !n.bot.name.trim() || !n.bot.system.trim() : !n.agent) || !n.prompt.trim();
    case "routine":
      return !n.routine;
    case "llm":
      return !n.model || !n.prompt.trim();
    case "schedule":
      return !n.cron.trim();
    case "notify":
      return !n.channel || (n.to.kind === "contact" ? !n.to.person : !n.to.room) || !n.text.trim();
    case "http":
      return !/^https?:\/\/[^/\s]+/.test(n.url.trim());
    default:
      return false;
  }
}
/** Labels the graph schema needs, and blank lines left in key lists. */
const tidy = (g: FlowGraph, t: ReturnType<typeof useT>): FlowGraph => ({
  ...g,
  nodes: g.nodes.map((n) => {
    const label = n.label.trim() || t(STEP[n.kind].label);
    if (n.kind === "table_read") return { ...n, label, keys: n.keys.map((k) => k.trim()).filter(Boolean) };
    if (n.kind === "table_write") return { ...n, label, key: n.key.trim() };
    if (n.kind === "http") return { ...n, label, url: n.url.trim(), body: n.method === "GET" ? "" : n.body };
    if (n.kind === "condition" && n.cases)
      return { ...n, label, cases: n.cases.map((c) => ({ ...c, label: c.label.trim() })) };
    if (n.kind === "sql") return { ...n, label, database: n.database.trim() };
    if (n.kind === "cmd") return { ...n, label, command: n.command.trim() };
    return { ...n, label };
  }),
});

/** What the step card covers: its column at the right, or the bottom sheet on a phone (as in side-panel.css). */
const cover: Cover = (w, h) =>
  w <= 640 ? { right: 0, bottom: h * 0.6 } : { right: Math.min(400, w - 24) + 12, bottom: 0 };

/** The full-screen editor: step types at the left, the canvas, and the chosen step's settings in a card over it. */
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
  // Over the whole window, its bar sits where the window controls are.
  const desktop = useDesktopClass();
  const projects = useData((s) => s.projects);
  const allAgents = useData((s) => s.agents);
  const allRoutines = useRoutines((s) => s.routines);
  const known = useKnown();
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
  // A step to pan to the middle of the canvas, asked again each time.
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const centre = useCallback((id: string) => setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);
  // On a phone the step types sit behind a button.
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [trial, setTrial] = useState<Map<string, TryStep> | null>(null);
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
      setSaved(JSON.stringify([g, ""]));
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
  // The project's agents and, always, the super-agent, first.
  const agents = useMemo(
    () =>
      Object.values(allAgents)
        .filter((a) => a.kind === "secretary" || (projectId && a.project_id === projectId))
        .sort((a, b) => Number(b.kind === "secretary") - Number(a.kind === "secretary")),
    [allAgents, projectId],
  );
  const routines = useMemo(
    () => allRoutines.filter((r) => r.project_id === projectId && r.schedule.kind === "manual"),
    [allRoutines, projectId],
  );
  const g = graph ?? EMPTY;
  // The core checks the drawing as it changes (its agents, routines and models in this project), before the first
  // save too: a new flow is checked as one of the chosen project.
  useEffect(() => {
    if (!graph || (!flow && !projectId)) return;
    let live = true;
    const timer = setTimeout(() => {
      if (graph.nodes.some(blank) || !triggerOf(graph)) return setProblem(undefined);
      const target = flow ? { flow: flow.id } : { project: projectId };
      void client.call("flows.validate", { ...target, graph: tidy(graph, t) }).then(
        (r) => live && setProblem(r.issues[0] ? describeIssue(r.issues[0], graph, t) : null),
        () => live && setProblem(undefined),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [flow, graph, projectId, t]);
  // The same measure before and after a new flow's first save, so it isn't unsaved while the saved flow comes back.
  const dirty = graph !== undefined && JSON.stringify([g, name]) !== saved;
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
    const from = isTrigger(kind) ? undefined : (sel ?? g.nodes.at(-1));
    const at = from ? g.layout.find((p) => p.node === from.id) : undefined;
    const below = g.layout.filter((p) => at && p.x === at.x + 280).length;
    let next: FlowGraph = {
      ...g,
      nodes: [...g.nodes, node],
      layout: [...g.layout, { node: node.id, x: at ? at.x + 280 : 0, y: at ? at.y + below * 120 : 0 }],
    };
    // Out of a check, the first way out nothing leaves by yet.
    const way =
      from?.kind === "condition"
        ? branchesOf(from, t).find((b) => !g.edges.some((e) => e.source === from.id && (e.when ?? "yes") === b.id))?.id
        : undefined;
    if (from) next = connectNodes(next, from.id, node.id, way);
    // A read after a save reads the table that save names.
    const table = node.kind === "table_read" ? savedTableBefore(next, node.id) : undefined;
    if (table) next = { ...next, nodes: next.nodes.map((n) => (n.id === node.id ? { ...n, table } : n)) };
    change(next);
    setSelected(node.id);
    centre(node.id);
    setPalette(false);
  };
  const saveBefore = (id: string) => {
    let i = 1;
    while (g.nodes.some((n) => n.id === `table_write-${i}`)) i++;
    const node = newNode("table_write", `table_write-${i}`, t(STEP.table_write.label));
    change(insertBefore(g, id, node));
    setSelected(node.id);
  };
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const base = {
        title: n.label || t(STEP[n.kind].label),
        ...stepDetail(n, flow?.id, allAgents, allRoutines, t, known),
      };
      const s = trial?.get(n.id);
      if (!s) return base;
      switch (s.state) {
        case "ran":
          return {
            ...base,
            state: "ran",
            badge: s.branch === null || n.kind !== "condition" ? "ok" : branchName(n, s.branch, t),
          };
        case "would_run":
          return { ...base, state: "ran", badge: t("flow.ed.tryWouldBadge") };
        case "skipped":
          return { ...base, state: "skipped", badge: t("flow.legend.stepSkipped") };
        case "missing":
          return { ...base, state: "failed", badge: t("flow.ed.tryMissingBadge") };
        default:
          return { ...base, badge: t("flow.ed.tryUnknownBadge") };
      }
    },
    [trial, flow?.id, allAgents, allRoutines, t, known],
  );

  const save = async () => {
    const missing = !name.trim()
      ? t("flow.ed.needName")
      : !projectId
        ? t("flow.ed.needProject")
        : !triggerOf(g)
          ? t("flow.ed.needTrigger")
          : undefined;
    const incomplete = g.nodes.find(blank);
    if (missing || incomplete) {
      setSaid({
        error: true,
        text:
          missing ?? t("flow.ed.complete", { step: incomplete?.label || t(STEP[incomplete?.kind ?? "webhook"].label) }),
      });
      if (incomplete) {
        setSelected(incomplete.id);
        centre(incomplete.id);
      }
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
        // On, a saved drawing runs: new events use it, events already received finish as they started. Where it
        // sends or what it calls, when new, is the owner's to allow first.
        const outward = await approveOutward(id, clean, doc.published);
        if (!outward) text = t("flow.ed.savedNotAllowed");
        else {
          const out = await client.call("flows.publish", {
            flow: id,
            expectedDraftVersion: doc.draftVersion,
            expectedPublishedRevision: doc.publishedRevision,
            outward,
          });
          next = { version: out.draftVersion, published: out.publishedRevision };
          text = t("flow.ed.savedPublished");
        }
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
  const hasTrigger = Boolean(triggerOf(g));
  return (
    <div className="fe" role="dialog" aria-modal="true" aria-label={name || t("flow.ed.untitled")}>
      <header className={`fe-top window-bar${desktop}`}>
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
        {!flow && (
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
        <span className="fe-top__spacer" />
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
        <TryRun graph={g} tidy={() => tidy(g, t)} onResult={setTrial} />
        <Button disabled={busy || !graph} onClick={() => void save()}>
          {t("flow.ed.save")}
        </Button>
        <Button
          variant="ghost"
          leadingIcon={<Icons.LogOut size={14} />}
          aria-label={t("flow.ed.close")}
          onClick={close}
        >
          {t("flow.ed.exit")}
        </Button>
      </header>
      <div className="fe-body">
        <nav className={palette ? "fe-pal is-open" : "fe-pal"} aria-label={t("flow.ed.palette")}>
          {PALETTE.map((group) => (
            <div key={group.group} className="fe-pal__group">
              <span className="fe-pal__label">{t(group.group)}</span>
              {group.kinds.map((kind) => {
                const taken = isTrigger(kind) && hasTrigger;
                const meta = STEP[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    className="fe-pal__item"
                    disabled={taken}
                    title={taken ? t("flow.ed.oneTrigger") : undefined}
                    aria-label={t("flow.ed.add", { kind: t(meta.label) })}
                    onClick={() => !taken && add(kind as StepKind)}
                  >
                    <FlowStepTile icon={meta.icon} tone={meta.tone} size="lg" />
                    <span className="fe-pal__text">
                      <span className="fe-pal__name">{t(meta.label)}</span>
                      {meta.body && <span className="fe-pal__body">{t(meta.body)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <StepList
            graph={g}
            problem={problem}
            select={(id) => {
              setSelected(id);
              centre(id);
              setPalette(false);
            }}
          />
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
              // A step added is centred like a clicked one (`centre`), so only another flow fits the view again.
              fitKey={flow?.id ?? "new"}
              focus={{ request: focus, cover, onClick: centre }}
            />
          )}
          {graph && !g.nodes.length && (
            <div className="fe-blank">
              <FlowStepTile icon={<Icons.Plus />} size="lg" />
              <strong>{t("flow.ed.blankTitle")}</strong>
              <span>{t("flow.ed.blankBody")}</span>
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="fe-pal-toggle"
            leadingIcon={palette ? <Icons.X size={14} /> : <Icons.Plus size={14} />}
            aria-expanded={palette}
            onClick={() => setPalette((o) => !o)}
          >
            {t(palette ? "common.close" : "flow.ed.addStep")}
          </Button>
          {sel && (
            <Drawer
              inset
              className="fe-card"
              label={t("flow.ed.stepSettings")}
              title={sel.label || t(STEP[sel.kind].label)}
              onClose={() => setSelected(null)}
              actions={
                <IconButton
                  size="sm"
                  label={t("flow.ed.delete")}
                  icon={<Icons.Trash2 size={14} />}
                  onClick={() => {
                    change(removeNode(g, sel.id));
                    setSelected(null);
                  }}
                />
              }
            >
              <Inspector
                graph={g}
                selected={sel}
                flowId={flow?.id}
                projectId={projectId}
                agents={agents}
                routines={routines}
                update={(n) => change({ ...g, nodes: g.nodes.map((x) => (x.id === n.id ? n : x)) })}
                branch={(source, target, when) =>
                  change({
                    ...g,
                    edges: g.edges.map((e) => (e.source === source && e.target === target ? { ...e, when } : e)),
                  })
                }
                removeCase={(check, id) => change(removeCase(g, check, id))}
                saveBefore={saveBefore}
                unlink={(source, target) =>
                  change({ ...g, edges: g.edges.filter((e) => !(e.source === source && e.target === target)) })
                }
              />
            </Drawer>
          )}
        </div>
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

type TryStep = Result<"flows.try_graph">["steps"][number];

/** Sample data through the drawing, branches and all, as a run would check it; nothing is saved or sent. */
function TryRun({
  graph,
  tidy: tidied,
  onResult,
}: {
  graph: FlowGraph;
  tidy: () => FlowGraph;
  onResult: (r: Map<string, TryStep> | null) => void;
}) {
  const t = useT();
  const timed = triggerOf(graph)?.kind === "schedule";
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<string>();
  const [answer, setAnswer] = useState("");
  const text = sample ?? (timed ? "{}" : '{\n  "type": "lead"\n}');
  const go = async () => {
    if (!triggerOf(graph)) return setAnswer(t("flow.ed.needTrigger"));
    if (graph.nodes.some(blank)) return setAnswer(t("flow.ed.tryNeedsShape"));
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return setAnswer(t("flow.ed.tryBadJson"));
    }
    try {
      const drawn = tidied();
      const { steps } = await client.call("flows.try_graph", { graph: drawn, data });
      onResult(new Map(steps.map((s) => [s.node, s])));
      const name = (id: string) => drawn.nodes.find((n) => n.id === id)?.label ?? id;
      const missing = steps.find((s) => s.state === "missing");
      const work = steps.filter((s) => s.state === "would_run").map((s) => name(s.node));
      setAnswer(
        missing
          ? t("flow.ed.tryMissing", { step: name(missing.node) })
          : work.length
            ? t("flow.ed.tryWould", { steps: work.join(", ") })
            : t("flow.ed.tryStop"),
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
        <p>{t(timed ? "flow.ed.tryHintTimed" : "flow.ed.tryHint")}</p>
        <Textarea
          aria-label={t("flow.ed.trySample")}
          rows={6}
          className="fe-mono"
          value={text}
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
