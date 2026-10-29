import { ApxError } from "@apx/protocol/client";
import { shapeOfGraph } from "@apx/protocol/flow-shape";
import { Button, FlowStepTile, IconButton, Icons, Input, Select, Spinner } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer } from "../common/Drawer.tsx";
import { client } from "../data/client.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useDesktopClass } from "../shell/desktop.ts";
import { go } from "../shell/nav.ts";
import { blank, blankWith } from "./complete.ts";
import { describeIssue, issueText, shownGraph, useKnown, whoOf } from "./data.ts";
import { slug, tidy } from "./drawing.ts";
import { type Cover, FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { FlowChat } from "./FlowChat.tsx";
import { EditorHistory } from "./FlowHistory.tsx";
import { connectNodes, disconnectNodes, moveNode, newNode, removeCase, removeNode } from "./graph-edit.ts";
import { Inspector, StepList } from "./Inspector.tsx";
import { LeaveDialog, useLeave } from "./LeaveDialog.tsx";
import { stepDetail } from "./look.tsx";
import { approveOutward } from "./outward.tsx";
import { useRunLog } from "./RunLog.tsx";
import { viewGraphRun } from "./run-view.ts";
import { STARTERS, type Starter, starterGraph } from "./starters.ts";
import {
  branchesOf,
  branchName,
  type Flow,
  type FlowGraph,
  type FlowNode,
  isTrigger,
  PALETTE,
  pathOf,
  STEP,
  type StepKind,
  triggerOf,
} from "./steps.tsx";
import { type LogPlace, TestButton, TestLog, TestStepCard, TestStrip } from "./TestMode.tsx";
import { TryRun, type TryStep } from "./TryRun.tsx";
import { useTables } from "./tables-data.ts";
import { useFlowAddress } from "./useFlowAddress.ts";
import { useFlowChat } from "./useFlowChat.ts";
import { useFlowTest } from "./useFlowTest.ts";
import { savedTableBefore } from "./values.ts";
import "./editor.css";

const EMPTY: FlowGraph = { schemaVersion: 2, nodes: [], edges: [], layout: [] };
/** What a card covers (the step's or the chat): a column at the right, or the bottom sheet on a phone (side-panel.css). */
const cover: Cover = (w, h) =>
  w <= 640 ? { right: 0, bottom: h * 0.6 } : { right: Math.min(400, w - 24) + 12, bottom: 0 };

/**
 * The full-screen editor: step types at the left, the canvas, and over it one card at a time: the chosen step's settings
 * or the chat with the super-agent, who draws while the owner watches (DECISIONS.md#d-175).
 */
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
  const [trial, setTrial] = useState<Map<string, TryStep> | null>(null);
  // What the last save said, shown in the top bar until the next change.
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);
  // A new flow's id once it is made here or by the agent, before the list brings the flow back.
  const [made, setMade] = useState<string>();
  const id = flow?.id ?? made;
  // The agent whose saved draft waits for the owner's review (their Save makes it theirs).
  const [draftBy, setDraftBy] = useState<string | null>(null);
  const ask = useFlowChat(
    { id, projectId, name, graph, saved, version, draftBy },
    {
      graph: setGraph,
      saved: setSaved,
      version: setVersion,
      published: setPublished,
      draftBy: setDraftBy,
      name: setName,
      made: setMade,
      said: setSaid,
      clearTrial: () => setTrial(null),
      closeStep: () => {
        setSelected(null);
        setPalette(false);
      },
      onSaved,
    },
  );
  const { boss, chat, open: chatOpen, setOpen: setChatOpen, notice, locked, fresh } = ask;
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
      setDraftBy(s.draftBy);
      setSaved(JSON.stringify([g, flow.name]));
    });
    return () => {
      live = false;
    };
  }, []);
  const { path, address, savedPath, chosenPath, setSavedPath } = useFlowAddress({ flow, id, made, name, projectId });
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
  // A save that leaves a required column of its table empty is unfinished too (DECISIONS.md#d-180).
  const tables = useTables(projectId || undefined);
  const unfinished = blankWith((table) => tables?.find((x) => x.name === table)?.required ?? []);
  // The core checks the drawing as it changes (its agents, routines and models in this project), before the first
  // save too: a new flow is checked as one of the chosen project.
  useEffect(() => {
    if (!graph || (!id && !projectId)) return;
    let live = true;
    const timer = setTimeout(() => {
      if (graph.nodes.some(blank) || !triggerOf(graph)) return setProblem(undefined);
      const target = id ? { flow: id } : { project: projectId };
      void client.call("flows.validate", { ...target, graph: tidy(graph, t) }).then(
        (r) => live && setProblem(r.issues[0] ? describeIssue(r.issues[0], graph, t) : null),
        () => live && setProblem(undefined),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, graph, projectId, t]);
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
  // A test with a real event (DECISIONS.md#d-178): the canvas lights its steps and can't change until it closes.
  const test = useFlowTest({
    flow: id,
    prepare: () => prepareTest(),
    say: (text, error) => setSaid({ text, ...(error ? { error: true } : {}) }),
  });
  const testing = test.active;
  const frozen = locked || testing;
  const who = useCallback(
    (n: FlowNode) => whoOf(n, allAgents, allRoutines, t, known),
    [allAgents, allRoutines, t, known],
  );
  const testView = useMemo(
    () => (test.run ? viewGraphRun(test.run, path, t, who) : undefined),
    [test.run, path, t, who],
  );
  const testLog = useRunLog(test.run, path, who);
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const base = {
        title: n.label || t(STEP[n.kind].label),
        ...stepDetail(n, path, allAgents, allRoutines, t, known),
      };
      if (testing) {
        const v = testView?.steps.get(n.id);
        return {
          ...base,
          ...(v?.state ? { state: v.state } : {}),
          ...(v?.order ? { order: v.order } : {}),
          ...(v?.badge ? { badge: v.badge } : {}),
        };
      }
      const s = trial?.get(n.id);
      const marked = fresh.get(n.id);
      if (!s && marked)
        return { ...base, mark: true, badge: t(marked === "new" ? "flow.ed.freshNew" : "flow.ed.freshChanged") };
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
    [trial, fresh, path, allAgents, allRoutines, t, known, testing, testView],
  );

  const save = async () => {
    const missing = !name.trim()
      ? t("flow.ed.needName")
      : !projectId
        ? t("flow.ed.needProject")
        : !triggerOf(g)
          ? t("flow.ed.needTrigger")
          : undefined;
    const incomplete = g.nodes.find(unfinished);
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
    const target = id ?? slug(name);
    // A flow that runs its old definition keeps it while the drawing stands for one (or gets one when new).
    const legacy = published === null && (result.ok || !id);
    setBusy(true);
    try {
      if (legacy) {
        const s = result.ok
          ? result.shape
          : { predicates: [], readKeys: [], tableKey: "latest", action: { kind: "none" as const } };
        const def = await client.call("flows.set", {
          id: target,
          projectId,
          name: name.trim(),
          enabled: flow?.enabled ?? false,
          predicates: s.predicates,
          tableKey: s.tableKey,
          action: s.action,
          ...(s.readKeys.length ? { readKeys: s.readKeys } : {}),
          ...(!savedPath && chosenPath ? { path: chosenPath } : {}),
        });
        setSavedPath(pathOf(def));
      } else if (flow && name.trim() !== flow.name) await client.call("flows.set", { ...flow, name: name.trim() });
      const doc = await client.call("flows.draft_save", { flow: target, expectedVersion: version, graph: clean });
      let next = { version: doc.draftVersion, published: doc.publishedRevision };
      const { issues } = await client.call("flows.validate", { flow: target, graph: clean });
      const first = issues[0];
      let text: string;
      if (first) text = t("flow.ed.savedCant", { reason: describeIssue(first, clean, t) });
      else if (published === null && result.ok) text = t(flow?.enabled ? "flow.ed.savedRuns" : "flow.ed.savedOff");
      else if (flow?.enabled && doc.draft && doc.draftVersion !== null) {
        // On, a saved drawing runs: new events use it, events already received finish as they started. Where it
        // sends or what it calls, when new, is the owner's to allow first.
        const outward = await approveOutward(target, clean, doc.published);
        if (!outward) text = t("flow.ed.savedNotAllowed");
        else {
          const out = await client.call("flows.publish", {
            flow: target,
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
      setDraftBy(null);
      if (!id) setMade(target);
      setProblem(first ? describeIssue(first, clean, t) : null);
      setGraph(clean);
      setSaved(JSON.stringify([clean, name]));
      setSaid({ text, ...(first ? { error: true } : {}) });
      if (first?.node) setSelected(first.node);
      onSaved(target);
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
  /**
   * Keeps the drawing as it is, steps not finished yet included, and never publishes: what runs stays as it was until
   * Save (DECISIONS.md#d-177). It still needs a name and a project, where the Flow lives. The Flow's id once saved.
   */
  const saveDraft = async (): Promise<string | undefined> => {
    const missing = !name.trim()
      ? t("flow.ed.needName")
      : !projectId
        ? t("flow.ed.needProject")
        : !g.nodes.length
          ? t("flow.chat.empty")
          : undefined;
    if (missing) {
      setSaid({ error: true, text: missing });
      return undefined;
    }
    const clean = tidy(g, t);
    setBusy(true);
    try {
      let target = id;
      if (target) {
        if (flow && name.trim() !== flow.name) await client.call("flows.set", { ...flow, name: name.trim() });
        // Over an agent's draft not reviewed yet, it keeps waiting for the owner's Save.
        const doc = await client.call("flows.draft_save", {
          flow: target,
          expectedVersion: version,
          graph: clean,
          ...(draftBy ? { unreviewed: true as const } : {}),
        });
        setVersion(doc.draftVersion);
        setPublished(doc.publishedRevision);
        setDraftBy(doc.draftBy);
      } else {
        // A new Flow is made off, with the drawing as its draft.
        const out = await client.call("flows.create", {
          project: projectId,
          name: name.trim(),
          graph: clean,
          ...(chosenPath ? { path: chosenPath } : {}),
        });
        target = out.flow.id;
        setSavedPath(pathOf(out.flow));
        setMade(target);
        setVersion(out.document.draftVersion);
      }
      setGraph(clean);
      setSaved(JSON.stringify([clean, name]));
      setSaid({ text: t(flow?.enabled ? "flow.ed.draftSavedRuns" : "flow.ed.draftSaved") });
      onSaved(target);
      return target;
    } catch (e) {
      setSaid({
        error: true,
        text:
          issueText(e, clean, t) ??
          t(e instanceof ApxError && e.code === "conflict" ? "flow.ed.conflict" : "flow.ed.saveFailed"),
      });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  /** A test runs what is saved: an unfinished step is named, unsaved edits are saved as a draft first. */
  const prepareTest = async (): Promise<string | undefined> => {
    const incomplete = g.nodes.find(unfinished);
    if (!triggerOf(g) || incomplete) {
      setSaid({
        error: true,
        text: incomplete
          ? t("flow.test.finish", { step: incomplete.label || t(STEP[incomplete.kind].label) })
          : t("flow.ed.needTrigger"),
      });
      if (incomplete) {
        setSelected(incomplete.id);
        centre(incomplete.id);
      }
      return undefined;
    }
    return id && !dirty ? id : saveDraft();
  };
  // Out of the editor, or to a table in Tables: unsaved edits are asked about first.
  const { leaving, away, leave, openChange } = useLeave(dirty, onClose, test.close);
  const close = () => away(onClose);
  const hasTrigger = Boolean(triggerOf(g));

  const agentName = allAgents[draftBy ?? ""]?.name ?? boss?.name ?? "";
  const stepCard = sel && !chatOpen && !locked ? sel : undefined;
  const timed = triggerOf(g)?.kind === "schedule";
  // The test's log: beside the canvas it makes it shorter (a new fit), as a sheet on a phone it covers its bottom.
  const [log, setLog] = useState<LogPlace | null>(null);
  const cardOpen = Boolean(stepCard || (chatOpen && chat));
  const over = log?.over ?? 0;
  const coverNow = useCallback<Cover>(
    (w, h) => {
      const c = cover(w, h);
      return { right: c.right, bottom: Math.max(c.bottom, over) };
    },
    [over],
  );
  const fitCover = useMemo<Cover | undefined>(
    () => (cardOpen ? coverNow : over ? () => ({ right: 0, bottom: over }) : undefined),
    [cardOpen, coverNow, over],
  );
  return (
    <div className="fe" role="dialog" aria-modal="true" aria-label={name || t("flow.ed.untitled")}>
      <header className={`fe-top window-bar${desktop}`}>
        <Input
          aria-label={t("flow.ed.name")}
          className="fe-top__name"
          placeholder={t("flow.ed.untitled")}
          value={name}
          disabled={frozen}
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
            className={said.error ? "fe-top__status is-said is-error" : "fe-top__status is-said"}
            role={said.error ? "alert" : "status"}
          >
            {said.text}
          </span>
        ) : (
          <span className={dirty ? "fe-top__status is-dirty" : "fe-top__status"} role="status">
            {busy
              ? t("flow.ed.saving")
              : dirty || !id
                ? t("flow.ed.unsaved")
                : draftBy
                  ? t("flow.ed.agentDrew", { name: agentName })
                  : t("flow.ed.saved")}
          </span>
        )}
        {boss && (
          <Button
            variant="secondary"
            className="fe-top__ask"
            leadingIcon={<Icons.Sparkles size={14} />}
            disabled={(!id && !projectId) || !graph || testing}
            title={!id && !projectId ? t("flow.ed.needProject") : undefined}
            aria-label={t("flow.ed.ask", { name: boss.name })}
            aria-pressed={chatOpen}
            onClick={() => (chatOpen ? setChatOpen(false) : void ask.openChat())}
          >
            <span className="fe-top__ask-text">{t("flow.ed.ask", { name: boss.name })}</span>
          </Button>
        )}
        <TestButton
          timed={timed}
          state={test.state}
          disabled={busy || !graph || locked || !hasTrigger || (!id && !projectId)}
          onStart={() => void test.start()}
        />
        <TryRun graph={g} tidy={() => tidy(g, t)} onResult={setTrial} disabled={testing} />
        <EditorHistory
          flow={id}
          running={published}
          version={version}
          unsaved={dirty}
          disabled={busy || !graph || frozen}
          onRestored={(doc) => {
            // The version comes back as the draft and replaces the canvas; what runs stays until Save.
            const back = doc.draft ?? doc.published ?? EMPTY;
            setGraph(back);
            setVersion(doc.draftVersion);
            setPublished(doc.publishedRevision);
            setDraftBy(doc.draftBy);
            // The name keeps what was saved, so a name typed meanwhile still shows as unsaved.
            setSaved(JSON.stringify([back, (JSON.parse(saved) as [unknown, string])[1]]));
            setTrial(null);
            setSelected(null);
            setSaid({ text: t(flow?.enabled ? "flow.ed.draftSavedRuns" : "flow.ed.draftSaved") });
          }}
        />
        <Button
          variant="secondary"
          className="fe-top__draft"
          disabled={busy || !graph || frozen}
          aria-label={t("flow.ed.saveDraft")}
          onClick={() => void saveDraft()}
        >
          <span className="fe-top__draft-text">{t("flow.ed.saveDraft")}</span>
          <span className="fe-top__draft-short" aria-hidden="true">
            {t("flow.card.draft")}
          </span>
        </Button>
        <Button disabled={busy || !graph || frozen} onClick={() => void save()}>
          {t("flow.ed.save")}
        </Button>
        <Button
          variant="ghost"
          className="fe-top__exit"
          leadingIcon={<Icons.LogOut size={14} />}
          aria-label={t("flow.ed.close")}
          onClick={close}
        >
          <span className="fe-top__exit-text">{t("flow.ed.exit")}</span>
        </Button>
      </header>
      <TestStrip
        state={test.state}
        path={path}
        timed={timed}
        onStop={() => void test.stop()}
        onAgain={() => void test.start()}
        onClose={test.close}
      />
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
                    disabled={taken || frozen}
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
              centre(id);
              setPalette(false);
              if (locked) return;
              setSelected(id);
              setChatOpen(false);
            }}
          />
          <p className="fe-pal__hint">{t("flow.ed.paletteHint")}</p>
        </nav>
        <div className="fe-main">
          <div className="fe-canvas">
            {graph && (
              <FlowCanvas
                graph={g}
                look={look}
                selected={stepCard ? selected : null}
                onSelect={(step) => {
                  // One card at a time: a step chosen takes the chat's place (its chat stays for the next "Ask").
                  if (locked) return;
                  setSelected(step);
                  if (step) setChatOpen(false);
                }}
                edit={
                  frozen
                    ? undefined
                    : {
                        move: (id, x, y) => change(moveNode(g, id, x, y)),
                        connect: (source, target, when) => change(connectNodes(g, source, target, when)),
                        disconnect: (source, target) => change(disconnectNodes(g, source, target)),
                      }
                }
                minimap={g.nodes.length > 0}
                // A step the owner adds is centred like a clicked one (`centre`); another flow, or steps an agent just drew,
                // fit the view again.
                fitKey={`${id ?? "new"}:${ask.drawn}:${log ? log.height : "-"}`}
                fitSteps={ask.fitSteps}
                focus={{ request: focus, cover: coverNow, fit: fitCover, card: cardOpen, onClick: centre }}
              />
            )}
            {locked && (
              <div className="fe-agent" role="status">
                <Spinner size={14} />
                {t("flow.ed.agentEditing", { name: boss?.name ?? "" })}
              </div>
            )}
            {graph && !g.nodes.length && (
              <div className="fe-blank">
                <FlowStepTile icon={<Icons.Plus />} size="lg" />
                <strong>{t("flow.ed.blankTitle")}</strong>
                <span>{t("flow.ed.blankBody")}</span>
              </div>
            )}
            {!testing && (
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
            )}
            {chatOpen && chat && (
              <FlowChat
                key={chat}
                threadId={chat}
                flowId={id}
                notice={notice}
                onClose={() => setChatOpen(false)}
                onRestart={() => void ask.openChat(true)}
                prepare={ask.prepare}
              />
            )}
            {stepCard && testing && (
              <Drawer
                inset
                className="fe-card"
                label={t("flow.ed.stepSettings")}
                title={stepCard.label || t(STEP[stepCard.kind].label)}
                onClose={() => setSelected(null)}
              >
                <TestStepCard step={testView?.steps.get(stepCard.id)} />
              </Drawer>
            )}
            {stepCard && !testing && (
              <Drawer
                inset
                className="fe-card"
                label={t("flow.ed.stepSettings")}
                title={stepCard.label || t(STEP[stepCard.kind].label)}
                onClose={() => setSelected(null)}
                actions={
                  <IconButton
                    size="sm"
                    label={t("flow.ed.delete")}
                    icon={<Icons.Trash2 size={14} />}
                    onClick={() => {
                      change(removeNode(g, stepCard.id));
                      setSelected(null);
                    }}
                  />
                }
              >
                <Inspector
                  graph={g}
                  selected={stepCard}
                  address={address}
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
                  openTable={(table) => away(() => go.tables(projectId, table))}
                  unlink={(source, target) =>
                    change({ ...g, edges: g.edges.filter((e) => !(e.source === source && e.target === target)) })
                  }
                />
              </Drawer>
            )}
          </div>
          {test.state.phase !== "idle" && test.state.phase !== "starting" && (
            <TestLog
              onPlace={setLog}
              entries={testLog}
              waiting={test.state.phase === "listening" ? t("flow.tlog.waiting") : undefined}
              onClose={test.close}
            />
          )}
        </div>
      </div>
      <LeaveDialog
        open={leaving}
        onOpenChange={openChange}
        locked={locked}
        busy={busy}
        leave={leave}
        saveDraft={saveDraft}
      />
    </div>
  );
}
