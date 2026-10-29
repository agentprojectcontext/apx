import type { Agent, ChannelInfo, Person, Result, Routine } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { graphOfDefinition, sameShape, shapeOfDefinition, shapeOfGraph } from "@apx/protocol/flow-shape";
import { useEffect, useMemo } from "react";
import type { FlowGraphIssue } from "../../../../packages/protocol/src/flow-graph.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { isKey, type MessageKey, t as translate } from "../i18n/index.ts";
import { go, nav } from "../shell/nav.ts";
import { approveOutward } from "./outward.tsx";
import { type Flow, type FlowGraph, type FlowNode, type FlowRun, STEP } from "./steps.tsx";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const loadFlows = async () => {
  const r = await client.call("flows.list", {});
  return { flows: r.flows, published: r.published, schedules: r.schedules, timeZone: r.time_zone };
};
export type Published = Result<"flows.list">["published"];
export type Schedules = Result<"flows.list">["schedules"];
export const loadRuns = (flow: string, limit = 14, cursor?: Result<"flows.events">["nextCursor"]) =>
  client.call("flows.events", { flow, limit, ...(cursor ? { cursor } : {}) });
/** One graph run step by step. */
export const loadRun = (flow: string, event: string) => client.call("flows.run_get", { flow, event });
export type RunDetail = Result<"flows.run_get">;

/**
 * Turning a flow on runs what was last saved: a drawing its old definition can't stand for is published first, so
 * new events run it. Turning it off only stops new runs. Undefined when the owner did not let it send or call out.
 */
export async function setEnabled(flow: Flow, enabled: boolean) {
  if (enabled && !(await publishSaved(flow))) return undefined;
  return client.call("flows.set", { ...flow, enabled });
}

/**
 * Publishes the saved drawing when it differs from what runs; nothing when there is nothing new. False when it sends
 * or calls somewhere new and the owner said no, or when an agent drew it: then its editor opens for the owner to look
 * at it and save it first (DECISIONS.md#d-174).
 */
export async function publishSaved(flow: Flow): Promise<boolean> {
  const doc = await client.call("flows.graph_get", { flow: flow.id });
  if (!doc.draft || doc.draftVersion === null) return true;
  if (doc.draftBy) {
    notify(translate("flow.reviewAgent"), "info");
    go.flows(nav.get().flowProject, flow.id, true);
    return false;
  }
  if (!doc.published) {
    const shape = shapeOfGraph(doc.draft);
    if (shape.ok && sameShape(shape.shape, shapeOfDefinition(flow))) return true;
  }
  const outward = await approveOutward(flow.id, doc.draft, doc.published);
  if (!outward) return false;
  await client.call("flows.publish", {
    flow: flow.id,
    expectedDraftVersion: doc.draftVersion,
    expectedPublishedRevision: doc.publishedRevision,
    outward,
  });
  return true;
}

/** Why a drawing can't run, in the person's words, from what the core said (its first issue). */
export function issueText(error: unknown, graph: FlowGraph | undefined, t: T): string | undefined {
  const issues =
    error instanceof ApxError ? (error.detail as { issues?: FlowGraphIssue[] } | undefined)?.issues : undefined;
  const first = issues?.[0];
  return first ? describeIssue(first, graph, t) : undefined;
}
export function describeIssue(issue: FlowGraphIssue, graph: FlowGraph | undefined, t: T): string {
  const step = graph?.nodes.find((n) => n.id === issue.node)?.label ?? "";
  const key = `flow.issue.${issue.code}`;
  // An issue about a variable names it, as the core wrote it ($vars.name).
  const name = issue.message.match(/\$vars\.[A-Za-z0-9_]+/)?.[0] ?? "";
  return isKey(key) ? t(key, { step, name }) : t("flow.issue.other", { step });
}

export type Shown = {
  graph: FlowGraph;
  /** The saved draft differs from what runs (it does not run yet), or matches it. */
  draftPending: boolean;
  draftVersion: number | null;
  draft: FlowGraph | null;
  /** The revision new events run, when the flow runs a published drawing. */
  publishedRevision: number | null;
  /** The agent that saved the draft, waiting for the owner's review; null when the owner saved it. */
  draftBy: string | null;
};

/**
 * What the detail and editor draw: a published drawing as it runs; otherwise the saved graph when it is exactly what
 * runs (it keeps names and places), else the running definition, placed where the draft had the same steps.
 */
export async function shownGraph(flow: Flow, t: T): Promise<Shown> {
  const doc = await client.call("flows.graph_get", { flow: flow.id });
  const draft = doc.draft;
  if (doc.published)
    return {
      graph: doc.published,
      draftPending: Boolean(draft),
      draftVersion: doc.draftVersion,
      draft,
      publishedRevision: doc.publishedRevision,
      draftBy: doc.draftBy,
    };
  const shape = draft ? shapeOfGraph(draft) : undefined;
  const runs = shape?.ok === true && sameShape(shape.shape, shapeOfDefinition(flow));
  const graph = runs && draft ? draft : legacyGraph(flow, t, draft?.layout);
  return {
    graph,
    draftPending: Boolean(draft) && !runs,
    draftVersion: doc.draftVersion,
    draft,
    publishedRevision: null,
    draftBy: doc.draftBy,
  };
}
/** The legacy definition drawn as steps. */
export const legacyGraph = (flow: Flow, t: T, layout?: FlowGraph["layout"]) =>
  graphOfDefinition(shapeOfDefinition(flow), (kind) => t(STEP[kind].label), layout);

/** The agent behind a step, for its avatar and name. */
export function agentOf(
  n: FlowNode | Flow["action"],
  agents: Record<string, Agent>,
  routines: Routine[],
): Agent | undefined {
  if (n.kind === "agent") return n.agent ? agents[n.agent] : undefined;
  if (n.kind === "routine") {
    const r = routines.find((x) => x.id === n.routine);
    return r ? agents[r.agent_id] : undefined;
  }
  return undefined;
}
/** The owner's channels and people, to name where a notify step sends. */
export type Known = { channels: ChannelInfo[]; persons: Person[] };
/** The owner's channels and people, loaded once when a Flows screen needs them. */
export function useKnown(): Known {
  const ready = useChannels((s) => s.ready);
  const channels = useChannels((s) => s.channels);
  const persons = useChannels((s) => s.persons);
  useEffect(() => {
    if (!ready) void loadChannels();
  }, [ready]);
  return useMemo(() => ({ channels, persons }), [channels, persons]);
}

export function whoOf(n: FlowNode, agents: Record<string, Agent>, routines: Routine[], t?: T, known?: Known): string {
  if (n.kind === "agent") return n.bot ? n.bot.name : (agents[n.agent ?? ""]?.name ?? n.agent ?? "");
  if (n.kind === "routine") return routines.find((r) => r.id === n.routine)?.name ?? n.routine;
  if (n.kind === "notify") {
    const d = known && destinationOf(n, known);
    return d ? `${d.channel.label} → ${d.owner && t ? t("flow.f.toYou") : d.to}` : "";
  }
  if (n.kind === "http") return `${n.method} ${hostOf(n.url)}`;
  return "";
}

/** Where a notify step sends, from the owner's channels and contacts; undefined until they are loaded or when gone. */
export function destinationOf(n: Extract<FlowNode, { kind: "notify" }>, { channels, persons }: Known) {
  const channel = channels.find((c) => c.id === n.channel);
  if (!channel) return undefined;
  if (n.to.kind === "room") {
    const id = n.to.room;
    const room = channel.rooms?.rooms.find((r) => r.id === id);
    return room ? { channel, to: `#${room.name || room.id}`, owner: false } : undefined;
  }
  const id = n.to.person;
  const person = persons.find((p) => p.id === id);
  return person ? { channel, to: person.name, owner: person.role === "owner" } : undefined;
}

/** The host a URL calls, as people read it. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export type { FlowRun };
