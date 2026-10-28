import type { Agent, Result, Routine } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { graphOfDefinition, sameShape, shapeOfDefinition, shapeOfGraph } from "@apx/protocol/flow-shape";
import type { FlowGraphIssue } from "../../../../packages/protocol/src/flow-graph.ts";
import { client } from "../data/client.ts";
import { isKey, type MessageKey } from "../i18n/index.ts";
import { type Flow, type FlowGraph, type FlowNode, type FlowRun, STEP } from "./steps.tsx";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const loadFlows = async () => {
  const r = await client.call("flows.list", {});
  return { flows: r.flows, published: r.published };
};
export type Published = Result<"flows.list">["published"];
export const loadRuns = (flow: string, limit = 14, cursor?: Result<"flows.events">["nextCursor"]) =>
  client.call("flows.events", { flow, limit, ...(cursor ? { cursor } : {}) });
/** One graph run step by step. */
export const loadRun = (flow: string, event: string) => client.call("flows.run_get", { flow, event });
export type RunDetail = Result<"flows.run_get">;

/**
 * Turning a flow on runs what was last saved: a drawing its old definition can't stand for is published first, so
 * new events run it. Turning it off only stops new runs.
 */
export async function setEnabled(flow: Flow, enabled: boolean) {
  if (enabled) await publishSaved(flow);
  return client.call("flows.set", { ...flow, enabled });
}

/** Publishes the saved drawing when it differs from what runs; nothing when there is nothing new. */
export async function publishSaved(flow: Flow): Promise<void> {
  const doc = await client.call("flows.graph_get", { flow: flow.id });
  if (!doc.draft || doc.draftVersion === null) return;
  if (!doc.published) {
    const shape = shapeOfGraph(doc.draft);
    if (shape.ok && sameShape(shape.shape, shapeOfDefinition(flow))) return;
  }
  await client.call("flows.publish", {
    flow: flow.id,
    expectedDraftVersion: doc.draftVersion,
    expectedPublishedRevision: doc.publishedRevision,
  });
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
  return isKey(key) ? t(key, { step }) : t("flow.issue.other", { step });
}

export type Shown = {
  graph: FlowGraph;
  /** The saved draft differs from what runs (it does not run yet), or matches it. */
  draftPending: boolean;
  draftVersion: number | null;
  draft: FlowGraph | null;
  /** The revision new events run, when the flow runs a published drawing. */
  publishedRevision: number | null;
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
  if (n.kind === "agent") return agents[n.agent];
  if (n.kind === "routine") {
    const r = routines.find((x) => x.id === n.routine);
    return r ? agents[r.agent_id] : undefined;
  }
  return undefined;
}
export function whoOf(n: FlowNode, agents: Record<string, Agent>, routines: Routine[]): string {
  if (n.kind === "agent") return agents[n.agent]?.name ?? n.agent;
  if (n.kind === "routine") return routines.find((r) => r.id === n.routine)?.name ?? n.routine;
  return "";
}

export type { FlowRun };
