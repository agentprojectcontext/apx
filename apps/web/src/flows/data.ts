import type { Agent, Result, Routine } from "@apx/protocol";
import { graphOfDefinition, sameShape, shapeOfDefinition, shapeOfGraph } from "@apx/protocol/flow-shape";
import { client } from "../data/client.ts";
import type { MessageKey } from "../i18n/index.ts";
import { type Flow, type FlowGraph, type FlowNode, type FlowRun, STEP } from "./steps.tsx";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const loadFlows = async () => (await client.call("flows.list", {})).flows;
export const loadRuns = (flow: string, limit = 14, cursor?: Result<"flows.events">["nextCursor"]) =>
  client.call("flows.events", { flow, limit, ...(cursor ? { cursor } : {}) });

/** Turning a flow on or off saves the same definition with the other switch position. */
export const setEnabled = (flow: Flow, enabled: boolean) => client.call("flows.set", { ...flow, enabled });

export type Shown = {
  graph: FlowGraph;
  /** The saved draft differs from what runs (it does not run yet), or matches it. */
  draftPending: boolean;
  draftVersion: number | null;
  draft: FlowGraph | null;
};

/**
 * What the detail and editor draw: the saved graph when it is exactly what runs (it keeps names and places),
 * otherwise the running definition, placed where the draft had the same steps.
 */
export async function shownGraph(flow: Flow, t: T): Promise<Shown> {
  const doc = await client.call("flows.graph_get", { flow: flow.id });
  const draft = doc.draft;
  const shape = draft ? shapeOfGraph(draft) : undefined;
  const runs = shape?.ok === true && sameShape(shape.shape, shapeOfDefinition(flow));
  const graph =
    runs && draft ? draft : graphOfDefinition(shapeOfDefinition(flow), (kind) => t(STEP[kind].label), draft?.layout);
  return { graph, draftPending: Boolean(draft) && !runs, draftVersion: doc.draftVersion, draft };
}

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
