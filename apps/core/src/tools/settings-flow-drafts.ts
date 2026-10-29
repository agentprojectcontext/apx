// apx_settings' Flow drawings: the super-agent reads a Flow's graph, makes a new Flow, edits its draft step by step and
// checks it, as its own call through the router. A draft runs nothing until the owner publishes it in the editor, so
// these ask the owner only when outside content is in the turn (DECISIONS.md#d-174). The graph's shape is in the
// apx-flows skill, read on demand, never in the prompt.

import { flowBranches } from "@apx/protocol/flow-cases";
import {
  connectionError,
  connectNodes,
  disconnectNodes,
  layoutFlow,
  newNode,
  placeSteps,
  removeNode,
} from "@apx/protocol/flow-edit";
import { z } from "zod";
import {
  FlowDraftGraph,
  FlowGraph,
  type FlowGraphIssue,
  type FlowNode,
} from "../../../../packages/protocol/src/flow-graph.ts";
import { CallError as CoreCallError } from "../errors.ts";
import type { Params, Setting } from "./settings-kit.ts";
import { projectName } from "./settings-kit.ts";
import type { ToolContext } from "./types.ts";

/** A draft: steps may keep settings empty until the owner publishes (DECISIONS.md#d-177). */
type Graph = z.infer<typeof FlowDraftGraph>;
type Doc = { flow: string; draftVersion: number | null; draft: Graph | null; published: Graph | null };
type Caller = Pick<ToolContext, "call" | "upsertPart">;

const KINDS = FlowGraph.shape.nodes.element.options.map((o) => o.shape.kind.value);
const Kind = z.enum(KINDS as [FlowNode["kind"], ...FlowNode["kind"][]]);
const Id = z.string().min(1).max(100);
/** A step as the agent writes it: its kind and the fields it sets; the rest start as a new step's do. */
const Step = z.object({ kind: Kind }).catchall(z.unknown());
const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), step: Step, after: Id.optional(), when: z.string().optional() }).strict(),
  z.object({ op: z.literal("update"), step: Id, set: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal("remove"), step: Id }).strict(),
  z.object({ op: z.literal("connect"), from: Id, to: Id, when: z.string().optional() }).strict(),
  z.object({ op: z.literal("disconnect"), from: Id, to: Id }).strict(),
  z.object({ op: z.literal("tidy") }).strict(),
]);
type Edit = z.infer<typeof Edit>;
/** A whole drawing as the agent writes it: places and the schema version are filled in when left out. */
const Drawing = z
  .object({
    schemaVersion: z.literal(2).optional(),
    nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(32),
    edges: z.array(z.record(z.string(), z.unknown())).max(64).default([]),
    layout: z.array(z.record(z.string(), z.unknown())).max(32).default([]),
  })
  .strict();
const Edits = z.array(Edit).min(1).max(40);

const ARGS = {
  graph_get: z.object({ flow: Id, which: z.enum(["draft", "published"]).optional() }).strict(),
  validate: z.object({ flow: Id }).strict(),
  create: z
    .object({
      project: Id,
      name: z.string().trim().min(1).max(120),
      graph: Drawing.optional(),
      edits: Edits.optional(),
    })
    .strict()
    .refine((p) => (p.graph === undefined) !== (p.edits === undefined), "pass graph or edits"),
  draft_save: z
    .object({
      flow: Id,
      expectedVersion: z.number().int().min(1).nullable().optional(),
      graph: Drawing.optional(),
      edits: Edits.optional(),
    })
    .strict()
    .refine((p) => (p.graph === undefined) !== (p.edits === undefined), "pass graph or edits")
    .refine(
      (p) => p.graph === undefined || p.expectedVersion !== undefined,
      "a whole graph replaces the draft: pass expectedVersion, the draftVersion you read (null when there was none)",
    ),
};

const SKILL = 'Step fields, bindings and templates: load_skill "apx-flows".';
const EMPTY: Graph = { schemaVersion: 2, nodes: [], edges: [], layout: [] };
const LABELS: Record<FlowNode["kind"], string> = {
  webhook: "Webhook",
  schedule: "Schedule",
  condition: "Check",
  vars: "Variables",
  js: "JavaScript",
  sql: "SQL",
  cmd: "Command",
  table_read: "Read table",
  table_write: "Save to table",
  llm: "Model",
  agent: "AI model",
  routine: "Routine",
  notify: "Notify",
  http: "Webhook out",
};
const CONNECT: Record<string, string> = {
  missing: "no such step",
  self: "a step can't lead into itself",
  trigger: "nothing leads into a trigger",
  limit: "a drawing has at most 64 connections",
  cycle: "it would make a loop",
};

/** Edits are refused with words the model can act on. */
class EditError extends Error {}

/** The issue paths of a drawing that doesn't parse, named by step: `step "send" (notify): text: …`. */
function parseIssues(graph: unknown, error: z.ZodError): string[] {
  const nodes = (graph as { nodes?: Array<{ id?: unknown; kind?: unknown }> }).nodes ?? [];
  return error.issues.slice(0, 12).map((i) => {
    const [top, index, ...rest] = i.path;
    if (top === "nodes" && typeof index === "number") {
      const n = nodes[index];
      return `step "${String(n?.id ?? index)}" (${String(n?.kind ?? "?")})${rest.length ? `: ${rest.join(".")}` : ""}: ${i.message}`;
    }
    return `${i.path.join(".") || "graph"}: ${i.message}`;
  });
}

/** A drawing that parses as a draft, or why it doesn't. */
function parsed(graph: unknown): Graph {
  const r = FlowDraftGraph.safeParse(graph);
  if (r.success) return r.data;
  throw new EditError(
    `the drawing is not valid:\n${parseIssues(graph, r.error)
      .map((l) => `- ${l}`)
      .join("\n")}`,
  );
}

/** A free step id for this kind: `http`, `http_2`… */
function freeId(graph: Graph, kind: string): string {
  const taken = new Set(graph.nodes.map((n) => n.id));
  if (!taken.has(kind)) return kind;
  for (let i = 2; ; i++) if (!taken.has(`${kind}_${i}`)) return `${kind}_${i}`;
}

/** A new step: the agent's fields over a new step's; settings it leaves empty wait in the draft, named by validate. */
function stepOf(graph: Graph, step: z.infer<typeof Step>): FlowNode {
  const id = typeof step.id === "string" && step.id ? step.id : freeId(graph, step.kind);
  if (graph.nodes.some((n) => n.id === id)) throw new EditError(`there is already a step "${id}"`);
  const label = typeof step.label === "string" && step.label ? step.label : LABELS[step.kind];
  const base: Record<string, unknown> = { ...newNode(step.kind, id, label) };
  // An AI step names an agent or a bot, never both: a bot given leaves the agent out.
  if (step.kind === "agent" && "bot" in step) delete base.agent;
  return { ...base, ...step, id, label } as FlowNode;
}

const findStep = (graph: Graph, id: string) => {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) throw new EditError(`no step "${id}"; the steps are ${graph.nodes.map((x) => x.id).join(", ") || "none"}`);
  return n;
};

function connect(graph: Graph, from: string, to: string, when?: string): Graph {
  findStep(graph, from);
  findStep(graph, to);
  const why = connectionError(graph, from, to);
  if (why === "duplicate") return graph;
  if (why) throw new EditError(`can't connect "${from}" to "${to}": ${CONNECT[why] ?? why}`);
  const check = graph.nodes.find((n) => n.id === from && n.kind === "condition");
  if (check?.kind === "condition" && when && !flowBranches(check).includes(when))
    throw new EditError(`check "${from}" has no way out "${when}"; its ways out are ${flowBranches(check).join(", ")}`);
  if (!check && when) throw new EditError(`only a check's connections take "when"; "${from}" is not a check`);
  return connectNodes(graph, from, to, when);
}

/** The drawing after each edit in order; every new step gets a place beside the one it follows. */
export function applyEdits(start: Graph, edits: readonly Edit[]): Graph {
  let g = start;
  for (const e of edits) {
    if (e.op === "add") {
      const node = stepOf(g, e.step);
      if (g.nodes.length >= 32) throw new EditError("a drawing has at most 32 steps");
      g = { ...g, nodes: [...g.nodes, node] };
      if (e.after) g = connect(g, e.after, node.id, e.when);
    } else if (e.op === "update") {
      const n = findStep(g, e.step);
      if ("id" in e.set || "kind" in e.set)
        throw new EditError(`a step's id and kind stay: remove "${e.step}" and add a new one instead`);
      g = { ...g, nodes: g.nodes.map((x) => (x === n ? ({ ...x, ...e.set } as FlowNode) : x)) };
    } else if (e.op === "remove") {
      findStep(g, e.step);
      g = removeNode(g, e.step);
    } else if (e.op === "connect") g = connect(g, e.from, e.to, e.when);
    else if (e.op === "disconnect") {
      if (!g.edges.some((x) => x.source === e.from && x.target === e.to))
        throw new EditError(`"${e.from}" does not lead into "${e.to}"`);
      g = disconnectNodes(g, e.from, e.to);
    } else g = { ...g, layout: layoutFlow(g) };
  }
  return placeSteps(g);
}

/** A whole drawing from the agent: its places kept where it gave them, the rest laid out. */
const drawingOf = (d: z.infer<typeof Drawing>): Graph =>
  placeSteps(parsed({ schemaVersion: 2, nodes: d.nodes, edges: d.edges, layout: d.layout }));

/** The drawing in few characters: steps and connections, without places. */
function compact(doc: Doc, which?: "draft" | "published") {
  const showing = which ?? (doc.draft ? "draft" : "published");
  const graph = showing === "draft" ? (doc.draft ?? doc.published) : doc.published;
  return {
    showing: graph === doc.draft && doc.draft ? "draft" : graph ? "published" : "none",
    graph: graph ? { nodes: graph.nodes, edges: graph.edges } : null,
  };
}

/** What the core said, in words the model acts on. */
function refusal(error: unknown): string {
  const code = error instanceof CoreCallError ? error.shape.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EditError) return `not saved: ${message}`;
  if (code === "conflict")
    return "not saved: the draft changed since you read it (the owner or another call saved it). Read it again with flows.graph_get and redo your change on that version.";
  return `not saved: ${message}`;
}

function issuesText(graph: Graph, issues: readonly FlowGraphIssue[]): string {
  if (!issues.length) return "It can run as drawn: the owner publishes it from the editor (Save with the Flow on).";
  const step = (id?: string) => {
    const n = id ? graph.nodes.find((x) => x.id === id) : undefined;
    return n ? `step "${n.id}" (${n.label}): ` : "";
  };
  return [
    "It can't run yet:",
    ...issues.slice(0, 12).map((i) => `- ${step(i.node)}${i.message} [${i.code}]`),
    "Fix these with flows.draft_save edits.",
  ].join("\n");
}

/** The card in the chat: the Flow's drawing and a way to open it in the editor. */
const card = (ctx: Caller, flow: string, project: string, name: string) =>
  ctx.upsertPart((p) => p.type === "flow" && p.flow === flow, { type: "flow", flow, project, name });

async function saved(
  ctx: Caller,
  d: Parameters<NonNullable<Setting["own"]>["run"]>[1],
  doc: Doc & { publishedRevision: number | null },
  made: boolean,
): Promise<string> {
  const flow = d.store.flows.get(doc.flow);
  const project = flow?.projectId ?? "";
  const name = flow?.name ?? doc.flow;
  card(ctx, doc.flow, project, name);
  const graph = doc.draft ?? doc.published ?? EMPTY;
  const { issues } = await ctx.call("flows.validate", { flow: doc.flow, graph });
  const where = `"${name}" (flow ${doc.flow}, ${projectName(d.store, project)})`;
  const head = doc.draft
    ? `${made ? "Made" : "Saved the draft of"} ${where}, draftVersion ${doc.draftVersion}. It runs nothing until the owner publishes it in the editor; the chat shows it with a button to open it there.`
    : `The drawing of ${where} is now the same as what runs (revision ${doc.publishedRevision}): no draft is left.`;
  return `${head}\n${issuesText(graph, issues)}`;
}

/** The settings for a Flow's drawing, merged into apx_settings' flows area. */
export const FLOW_DRAFTS: Readonly<Record<string, Setting>> = {
  "flows.graph_get": {
    does: `read a Flow's drawing (flow; which: draft or published, default the draft if there is one) as JSON steps and connections, with draftVersion for flows.draft_save. ${SKILL}`,
    own: {
      reads: true,
      // The whole drawing (commands, addresses, prompts) goes back to the model: asked with outside content around.
      confirm: "untrusted",
      args: ARGS.graph_get,
      async run(p, d, ctx) {
        const { flow, which } = ARGS.graph_get.parse(p);
        const doc = await ctx.call("flows.graph_get", { flow });
        const def = d.store.flows.get(flow);
        return JSON.stringify({
          flow,
          name: def?.name,
          project: def?.projectId,
          enabled: def?.enabled,
          draftVersion: doc.draftVersion,
          publishedRevision: doc.publishedRevision,
          ...compact(doc, which),
        });
      },
    },
  },
  "flows.validate": {
    does: "check whether a Flow's saved draft (or, without one, what runs) can run, and why not, step by step",
    own: {
      reads: true,
      confirm: "never",
      args: ARGS.validate,
      async run(p, _d, ctx) {
        const { flow } = ARGS.validate.parse(p);
        const doc = await ctx.call("flows.graph_get", { flow });
        const graph = doc.draft ?? doc.published;
        if (!graph) return "This Flow has no drawing yet: make one with flows.draft_save.";
        const { issues } = await ctx.call("flows.validate", { flow, graph });
        return issuesText(graph, issues);
      },
    },
  },
  "flows.create": {
    does: `make a new Flow in a project, off, with a drawing as its draft (project, name, and graph {nodes, edges} or edits). Places are filled in. The owner turns it on from the editor. ${SKILL}`,
    own: {
      confirm: "untrusted",
      args: ARGS.create,
      async run(p, d, ctx) {
        const a = ARGS.create.parse(p);
        try {
          const graph = parsed(a.graph ? drawingOf(a.graph) : applyEdits(EMPTY, a.edits ?? []));
          const made = await ctx.call("flows.create", { project: a.project, name: a.name, graph });
          return await saved(ctx, d, made.document, true);
        } catch (error) {
          return refusal(error);
        }
      },
    },
  },
  "flows.draft_save": {
    does: `change a Flow's draft (flow): edits [{op: add (step, after?, when?) | update (step, set) | remove (step) | connect (from, to, when?) | disconnect (from, to) | tidy}] on the latest draft, or a whole graph with expectedVersion. New steps get places. Publishing stays the owner's, in the editor. ${SKILL}`,
    own: {
      confirm: "untrusted",
      args: ARGS.draft_save,
      async run(p, d, ctx) {
        const a = ARGS.draft_save.parse(p);
        try {
          const doc = await ctx.call("flows.graph_get", { flow: a.flow });
          const graph = a.graph
            ? drawingOf(a.graph)
            : parsed(applyEdits(doc.draft ?? doc.published ?? EMPTY, a.edits ?? []));
          const expectedVersion = a.graph ? (a.expectedVersion ?? null) : doc.draftVersion;
          const next = await ctx.call("flows.draft_save", { flow: a.flow, expectedVersion, graph });
          return await saved(ctx, d, next, false);
        } catch (error) {
          return refusal(error);
        }
      },
    },
  },
};

/** Each Flow in a line: its name, id, project, whether it is on and what its drawing is. */
export function flowLines(d: Parameters<NonNullable<Setting["read"]>>[1], p: Params): string {
  const flows = d.store.flows.list(typeof p.project === "string" ? p.project : undefined);
  if (!flows.length) return "No Flows yet: make one with flows.create.";
  return flows
    .map((f) => {
      const doc = d.store.flowGraphs.get(f.id);
      const drawing = [
        doc.publishedRevision !== null ? `published revision ${doc.publishedRevision}` : "",
        doc.draft ? `draft version ${doc.draftVersion} not published` : "",
      ].filter(Boolean);
      return `- ${f.name} [${f.id}] in ${projectName(d.store, f.projectId)} (${f.projectId}): ${f.enabled ? "on" : "off"}, ${drawing.join(", ") || "no drawing (an old definition)"}`;
    })
    .join("\n");
}
