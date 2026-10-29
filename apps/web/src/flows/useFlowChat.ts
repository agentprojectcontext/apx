import { ApxError } from "@apx/protocol/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useLastFlowDraft } from "../data/flowDrafts.ts";
import { isPending, secretary } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { type Fresh, sameGraph, takeAgentDraft } from "./agentDraft.ts";
import { issueText } from "./data.ts";
import { blank, tidy } from "./drawing.ts";
import { bindFlowChat, flowChatOf, newFlowChat, rememberFlowChat } from "./flowChat.ts";
import { type FlowGraph, STEP } from "./steps.tsx";

/** What the editor holds that its chat reads: the flow, its drawing and what was last saved (`[graph, name]` JSON). */
export type EditorNow = {
  id: string | undefined;
  projectId: string;
  name: string;
  graph: FlowGraph | undefined;
  saved: string;
  version: number | null;
  draftBy: string | null;
};
/** How the chat changes the editor: a drawing saved or taken, a new flow's id, the bar's text, the cards. */
export type EditorSet = {
  graph: (g: FlowGraph) => void;
  saved: (s: string) => void;
  version: (v: number | null) => void;
  published: (v: number | null) => void;
  draftBy: (v: string | null) => void;
  name: (v: string) => void;
  made: (id: string) => void;
  said: (v: { text: string; error?: boolean } | null) => void;
  clearTrial: () => void;
  /** Closes the step card (and the step types on a phone). */
  closeStep: () => void;
  onSaved: (id: string) => void;
};

/**
 * The editor's chat with the super-agent (DECISIONS.md#d-175): opening it, what goes before each message (the owner's
 * edits saved, which Flow it is), and each drawing the agent saves taken onto the canvas while the owner watches.
 */
export function useFlowChat(at: EditorNow, set: EditorSet) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const boss = useData((s) => secretary(s.agents));
  const [chat, setChat] = useState<string>();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  // Steps the agent just added or changed, marked for a moment; `drawn` counts its drawings, each fitted into view.
  const [fresh, setFresh] = useState<Fresh>(new Map());
  const [drawn, setDrawn] = useState(0);
  // While the agent works in the chat the canvas is its: the owner watches, edits wait for its turn to end.
  const locked = useData((s) => isPending(chat ? s.threads[chat]?.state : undefined));
  // A new flow the agent was asked to make: the next one it makes in this project is this one.
  const awaiting = useRef(false);
  const g = at.graph;
  const lastSaved = () => JSON.parse(at.saved) as [FlowGraph, string];

  const openChat = async (restart = false) => {
    if (!boss || locked) return;
    const thread =
      (!restart && (chat ?? (at.id ? flowChatOf(at.id) : undefined))) ||
      (await newFlowChat(boss.id, at.projectId, at.name.trim() || t("flow.ed.untitled")));
    // The core tells the agent which Flow in each turn's input; the owner's messages stay their own words.
    if (!thread || !(await bindFlowChat(thread, at.projectId, at.id))) return;
    if (at.id) rememberFlowChat(at.id, thread);
    setChat(thread);
    set.closeStep();
    setNotice(undefined);
    setOpen(true);
  };

  /** Saves the owner's edits for the agent to start from; the name they were saved with, or null when they can't be. */
  const saveFirst = async (drawing: FlowGraph, savedName: string) => {
    const incomplete = drawing.nodes.find(blank);
    if (incomplete || !drawing.nodes.length) {
      const step = incomplete ? incomplete.label || t(STEP[incomplete.kind].label) : "";
      setNotice(incomplete ? t("flow.chat.finish", { step, name: boss?.name ?? "" }) : t("flow.chat.empty"));
      return null;
    }
    const clean = tidy(drawing, t);
    let flow = { id: at.id, name: savedName || at.name.trim() };
    try {
      if (flow.id) {
        // Over an agent's draft not yet reviewed, it stays waiting for the owner's Save.
        const doc = await client.call("flows.draft_save", {
          flow: flow.id,
          expectedVersion: at.version,
          graph: clean,
          ...(at.draftBy ? { unreviewed: true as const } : {}),
        });
        set.version(doc.draftVersion);
        set.published(doc.publishedRevision);
        set.draftBy(doc.draftBy);
      } else {
        const out = await client.call("flows.create", {
          project: at.projectId,
          name: at.name.trim() || t("flow.ed.untitled"),
          graph: clean,
        });
        flow = { id: out.flow.id, name: out.flow.name };
        set.made(out.flow.id);
        set.name(out.flow.name);
        set.version(out.document.draftVersion);
        if (chat) {
          rememberFlowChat(out.flow.id, chat);
          await bindFlowChat(chat, at.projectId, out.flow.id);
        }
        set.onSaved(out.flow.id);
      }
    } catch (e) {
      setNotice(
        issueText(e, clean, t) ??
          t(e instanceof ApxError && e.code === "conflict" ? "flow.ed.conflict" : "flow.ed.saveFailed"),
      );
      return null;
    }
    set.graph(clean);
    set.saved(JSON.stringify([clean, flow.name]));
    return flow;
  };

  /**
   * Before each message the owner's unsaved edits are saved as a draft, so the agent starts from what the owner sees.
   * The words go as the owner wrote them: which Flow it is, and its draft's version, the core adds to the turn.
   */
  const prepare = async (words: string): Promise<string | null> => {
    setNotice(undefined);
    if (!chat || !g) return null;
    const [was, savedName] = lastSaved();
    const flow = sameGraph(g, was) ? { id: at.id } : await saveFirst(g, savedName);
    if (!flow) return null;
    if (!flow.id) awaiting.current = true;
    return words;
  };

  // An agent's saved drawing shows at once; a new flow the agent was asked to make becomes this editor's flow.
  const last = useLastFlowDraft();
  // biome-ignore lint/correctness/useExhaustiveDependencies: each change the core tells is taken once, as it comes
  useEffect(() => {
    if (!last || last.by === null || !g) return;
    const adopt = !at.id && awaiting.current && last.project === at.projectId && last.by === boss?.id;
    if (!adopt && last.flow !== at.id) return;
    let live = true;
    void (async () => {
      const doc = await client.call("flows.graph_get", { flow: last.flow });
      const incoming = doc.draft ?? doc.published;
      if (!live || !incoming) return;
      let [was, savedName] = lastSaved();
      if (adopt) {
        awaiting.current = false;
        const listed = await client.call("flows.list", { project: at.projectId });
        savedName = listed.flows.find((f) => f.id === last.flow)?.name ?? at.name;
        was = g;
        set.made(last.flow);
        if (!at.name.trim()) set.name(savedName);
        if (chat) {
          rememberFlowChat(last.flow, chat);
          void bindFlowChat(chat, at.projectId, last.flow);
        }
        set.onSaved(last.flow);
      }
      const take = takeAgentDraft(g, was, incoming);
      if (take.kind === "keep") {
        set.said({ error: true, text: t("flow.ed.agentElsewhere", { name: agents[last.by ?? ""]?.name ?? "" }) });
        return;
      }
      set.version(doc.draftVersion);
      set.published(doc.publishedRevision);
      set.draftBy(doc.draftBy);
      set.saved(JSON.stringify([incoming, savedName]));
      if (take.kind === "take") {
        set.graph(incoming);
        setFresh(take.fresh);
        setDrawn((n) => n + 1);
        set.clearTrial();
        set.said(null);
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [last?.seq]);
  // Closed or replaced, the chat is no longer the editor's: later turns there say nothing of it.
  useEffect(
    () => () => {
      if (chat) void bindFlowChat(chat, undefined);
    },
    [chat],
  );
  useEffect(() => {
    if (!fresh.size) return;
    const timer = setTimeout(() => setFresh(new Map()), 6000);
    return () => clearTimeout(timer);
  }, [fresh]);
  // The agent at work closes the step card: nothing is edited under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the agent starts or stops
  useEffect(() => {
    if (locked) set.closeStep();
  }, [locked]);
  // What the agent just added is what a phone's fit shows, not the first steps.
  const fitSteps = useMemo(() => [...fresh].filter(([, how]) => how === "new").map(([step]) => step), [fresh]);

  return { boss, chat, open, setOpen, notice, locked, fresh, drawn, fitSteps, openChat, prepare };
}
