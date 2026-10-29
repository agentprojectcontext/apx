import { randomBytes } from "node:crypto";
import { ErrorCode } from "@apx/protocol";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import type { Bus } from "../bus.ts";
import { FlowGraphConflict, FlowGraphUnavailable } from "../domain/flow-graphs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound, unauthorized } from "../errors.ts";
import { type FlowOutside, flowOutward } from "../flow-outward.ts";
import { flowFolder } from "../flow-work-steps.ts";
import { type FlowModelCheck, flowDraftIssues } from "../flows.ts";
import { tildeHome } from "../paths.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

/** How freely a Flow's AI step acts: the owner sets it in the editor, an agent's draft keeps what is there. */
const OWNERS_FIELDS = ["autonomy", "write", "delegate"] as const;
/** Who an AI step runs as: under the owner's limits these stay too, so a limit never moves to another agent. */
const WHO = ["agent", "bot", "model"] as const;
type AiStep = Extract<FlowGraph["nodes"][number], { kind: "agent" }>;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Why an agent's drawing would change what the owner keeps, in words; undefined if it does not. `saved` is the draft
 * and what runs: an AI step's limits stay as they are, and a step the owner limited keeps who it runs as and stays in
 * the drawing (removing it and adding another would drop the limit).
 */
export function ownersFieldChange(saved: readonly (FlowGraph | null)[], after: FlowGraph): string | undefined {
  const steps = (g: FlowGraph | null) => (g?.nodes ?? []).filter((n): n is AiStep => n.kind === "agent");
  const current = saved.find((g) => g !== null) ?? null;
  for (const n of steps(after)) {
    const was = steps(current).find((b) => b.id === n.id);
    const field = OWNERS_FIELDS.find((f) => !same(n[f], was?.[f]));
    if (field)
      return `step "${n.id}": ${field} stays the owner's (how freely an AI step acts is set in the editor); leave it out`;
  }
  for (const g of saved)
    for (const limited of steps(g).filter((b) => OWNERS_FIELDS.some((f) => b[f] !== undefined))) {
      const now = steps(after).find((n) => n.id === limited.id);
      if (!now) return `step "${limited.id}" runs with limits the owner set: only the owner removes it, in the editor`;
      const was = steps(current).find((b) => b.id === limited.id) ?? limited;
      const who = WHO.find((f) => !same(now[f], was[f]));
      if (who) return `step "${limited.id}" runs with limits the owner set: its ${who} stays as the owner chose it`;
    }
  return undefined;
}

/** A Flow's identifier from its name, as the panel makes one: a readable slug and a short random tail. */
const idFor = (name: string) =>
  `${
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "flow"
  }-${randomBytes(3).toString("hex").slice(0, 4)}`;

/**
 * Who reaches a project's Flows and tables: the owner every project; an agent's own tool its project, or any when it
 * is global; an outside app, a channel or an agent's shell (no agent behind the call) none (DECISIONS.md#d-174).
 * Returns the project an agent is kept to, undefined for the owner or a global agent.
 */
export function flowReach(store: Store, missing: string) {
  return (ctx: CallContext, projectId?: string): string | undefined => {
    if (ctx.actor === "human" && !ctx.client && !ctx.channel) return undefined;
    const agent = ctx.agent && !ctx.client && !ctx.channel ? store.agents.get(ctx.agent.id) : undefined;
    if (!agent) throw unauthorized("Flows and tables are reserved to the owner and their agents' tools");
    if (agent.project_id && projectId !== undefined && agent.project_id !== projectId) throw notFound(missing);
    return agent.project_id ?? undefined;
  };
}

export function flowGraphHandlers(store: Store, model: FlowModelCheck, outside?: FlowOutside, bus?: Bus) {
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  const reach = flowReach(store, "Flow not found");
  const reached = (ctx: CallContext, id: string) => {
    const flow = found(id);
    reach(ctx, flow.projectId);
    return flow;
  };
  /** The agent behind a call that is not the owner's own. */
  const byAgent = (ctx: CallContext) => (ctx.actor === "human" ? undefined : ctx.agent?.id);
  /** An agent's draft leaves the owner's fields as they are. */
  const agentKeeps = (ctx: CallContext, flow: string | undefined, graph: FlowGraph) => {
    if (ctx.actor === "human") return;
    const doc = flow ? store.flowGraphs.get(flow) : undefined;
    // A draft the owner saved is theirs to have changed; one an agent saved is checked against what runs too.
    const saved = doc?.draft && doc.draftBy === null ? [doc.draft] : [doc?.draft ?? null, doc?.published ?? null];
    const changed = ownersFieldChange(saved, graph);
    if (changed) throw badRequest(changed);
  };
  const told = <D extends { flow: string; draftVersion: number | null }>(
    ctx: CallContext,
    projectId: string,
    doc: D,
  ) => {
    bus?.emit({
      type: "flow.draft",
      flow: doc.flow,
      project: projectId,
      draft_version: doc.draftVersion,
      by: ctx.agent?.id ?? null,
    });
    return doc;
  };
  const write = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CallError) throw error;
      if (error instanceof FlowGraphUnavailable)
        throw conflict(error.message, { reason: "graph_execution_unavailable" });
      if (error instanceof FlowGraphConflict) throw conflict(error.message);
      throw badRequest("Invalid Flow graph, binding or capacity exceeded");
    }
  };
  /** What a drawing does outside, for the project it belongs to: where its commands run is part of it. */
  const outwardOf = (projectId: string, graph: Parameters<typeof flowOutward>[1]) => {
    const project = store.projects.get(projectId);
    const local = graph.nodes.some((n) => n.kind === "cmd" || n.kind === "sql");
    const place = local ? (flowFolder(store, outside?.home, projectId) ?? "") : "";
    return flowOutward(store, graph, project?.path ? tildeHome(project.path) : (project?.name ?? ""), place);
  };
  return {
    "flows.graph_get": ({ flow }, ctx) => {
      reached(ctx, flow);
      return store.flowGraphs.get(flow);
    },
    "flows.draft_save": ({ flow, expectedVersion, graph, unreviewed }, ctx) => {
      const definition = reached(ctx, flow);
      agentKeeps(ctx, flow, graph);
      // A stale read only names who drew it: the save itself checks the version (DECISIONS.md#d-175).
      const drew = unreviewed && ctx.actor === "human" ? (store.flowGraphs.get(flow).draftBy ?? undefined) : undefined;
      return told(
        ctx,
        definition.projectId,
        write(() => store.flowGraphs.saveDraft(flow, expectedVersion, graph, byAgent(ctx) ?? drew)),
      );
    },
    "flows.draft_discard": ({ flow, expectedVersion }, ctx) => {
      const definition = found(flow);
      return told(
        ctx,
        definition.projectId,
        write(() => store.flowGraphs.discardDraft(flow, expectedVersion)),
      );
    },
    "flows.create": ({ project, name, graph }, ctx) => {
      if (!store.projects.get(project)) throw notFound("Project not found");
      reach(ctx, project);
      agentKeeps(ctx, undefined, graph);
      // Off and table-only, as a new drawing the panel saves first: nothing runs until the owner publishes it.
      const made = write(() =>
        store.tx(() => {
          let id = idFor(name);
          while (store.flows.get(id)) id = idFor(name);
          const flow = store.flows.save({
            id,
            projectId: project,
            name,
            enabled: false,
            predicates: [],
            tableKey: "latest",
            action: { kind: "none" },
          });
          return { flow, document: store.flowGraphs.saveDraft(id, null, graph, byAgent(ctx)) };
        }),
      );
      told(ctx, project, made.document);
      return made;
    },
    "flows.validate": ({ flow, project, graph }, ctx) => {
      if (flow !== undefined) reached(ctx, flow);
      else if (project !== undefined && store.projects.get(project)) reach(ctx, project);
      // A Flow not saved yet is checked as one of its project, off, with nothing else defined.
      const definition =
        flow !== undefined
          ? found(flow)
          : {
              id: "new",
              projectId: project ?? "",
              name: "New",
              enabled: false,
              predicates: [],
              tableKey: "latest",
              action: { kind: "none" as const },
            };
      if (flow === undefined && !store.projects.get(definition.projectId)) throw notFound("Project not found");
      const issues = flowDraftIssues(store, definition, graph, model, outside);
      return { valid: issues.length === 0, issues };
    },
    "flows.outward": ({ flow, graph }) => outwardOf(found(flow).projectId, graph),
    "flows.publish": ({ flow, expectedDraftVersion, expectedPublishedRevision, outward }, ctx) => {
      const definition = found(flow);
      const doc = write(() =>
        store.flowGraphs.publish(flow, expectedDraftVersion, expectedPublishedRevision, (graph) => {
          const issues = flowDraftIssues(store, definition, graph, model, outside);
          if (issues.length)
            throw new CallError({
              code: ErrorCode.BadRequest,
              message: issues[0]?.message ?? "The drawing cannot run",
              detail: { issues },
            });
          // Sending as the owner, calling other services, running commands and changing databases are approved by
          // publishing what the owner was shown.
          const { keys } = outwardOf(definition.projectId, graph);
          if (keys.length && JSON.stringify([...new Set(outward ?? [])].sort()) !== JSON.stringify(keys))
            throw conflict("Confirm what it sends, calls, runs and changes before it runs", {
              reason: "outward_unconfirmed",
              keys,
            });
        }),
      );
      return told(ctx, definition.projectId, doc);
    },
    "flows.run_get": ({ flow, event }) => {
      found(flow);
      const run = store.flowGraphRuns.detail(flow, event);
      if (!run) throw notFound("Flow run");
      const answered = (id: string | null) => {
        const r = id ? store.runs.get(id) : undefined;
        return r?.harness ? { answered: { harness: r.harness, model: r.model ?? null } } : {};
      };
      return { ...run, steps: run.steps.map((s) => ({ ...s, ...answered(s.run_id) })) };
    },
  } satisfies Partial<Handlers>;
}
