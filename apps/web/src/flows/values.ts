// What a step's template fields can insert, grouped for the picker (TemplateField): what arrived, earlier steps'
// results, variables, APX's own values and, only where the step resolves them itself, secrets (AGENTS.md rule 11).
import type { TemplateGroup } from "@apx/ui";
import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { MessageKey } from "../i18n/index.ts";
import { chainOrder, dotted } from "./graph-edit.ts";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Every field that takes placeholders. */
export type TemplateFieldKind = "message" | "header" | "body" | "sqlValue" | "env" | "stdin";
/**
 * Fields whose secrets the step reads inside the core, right before it uses them: an HTTP header, a command's
 * environment. Anywhere else (a message, a body, a model's prompt) a secret would travel as text, so none is offered.
 */
export const SECRET_FIELDS: ReadonlySet<TemplateFieldKind> = new Set(["header", "env"]);

/** What shows as a badge in a template, and which badges are secrets. */
export const TEMPLATE_PATTERN = /\$(trigger|steps|vars|apx)(\.[A-Za-z0-9_-]+)*|secret:\/\/[A-Za-z0-9_.~/-]+/g;
export const SECRET_PATTERN = /^secret:\/\//;

/** What a step gives the next ones: the part of its result a later step receives. */
export const RESULT: Partial<Record<FlowNode["kind"], string[]>> = {
  llm: ["text"],
  agent: ["text"],
  routine: ["text"],
  table_read: ["rows"],
  table_write: ["value"],
  http: [],
  vars: [],
  js: [],
  sql: ["rows"],
  cmd: ["stdout"],
};

/** Steps whose result can reach `id`: every step on a path before it, except the trigger (that is the event). */
export function earlier(graph: FlowGraph, id: string): FlowNode[] {
  const seen = new Set<string>();
  const todo = [id];
  while (todo.length) {
    const at = todo.pop();
    for (const e of graph.edges)
      if (e.target === at && !seen.has(e.source)) {
        seen.add(e.source);
        todo.push(e.source);
      }
  }
  return chainOrder(graph).filter((n) => seen.has(n.id) && RESULT[n.kind]);
}

/** Fields of what arrived that other steps already read: the ones worth naming. */
function knownFields(graph: FlowGraph): string[] {
  const paths = new Set<string>();
  const add = (b: FlowBinding) => b.kind === "event" && b.path.length > 0 && paths.add(dotted(b.path));
  for (const n of graph.nodes) {
    if ("input" in n && typeof n.input === "object") add(n.input);
    if (n.kind === "table_write") add(n.value);
  }
  return [...paths].sort();
}

/** The values `field` of step `n` may insert, in the picker's groups. */
export function valueGroups(
  graph: FlowGraph,
  n: FlowNode,
  field: TemplateFieldKind,
  secrets: readonly string[],
  t: T,
  /** A step's kind as people say it, beside its name. */
  kindName: (kind: FlowNode["kind"]) => string,
): TemplateGroup[] {
  const webhook = graph.nodes.some((x) => x.kind === "webhook");
  const before = earlier(graph, n.id);
  const groups: TemplateGroup[] = [
    {
      label: t("flow.v.arrived"),
      values: webhook
        ? [
            { insert: "$trigger", label: t("flow.v.everything") },
            ...knownFields(graph).map((p) => ({ insert: `$trigger.${p}`, label: p })),
          ]
        : [],
    },
    {
      label: t("flow.v.steps"),
      values: before
        .filter((s) => s.kind !== "vars")
        .map((s) => ({
          insert: ["$steps", s.id, ...(s.kind === "http" ? ["json"] : (RESULT[s.kind] ?? []))].join("."),
          label: s.label,
          hint: kindName(s.kind),
        })),
    },
    {
      label: t("flow.v.vars"),
      values: before.flatMap((s) =>
        s.kind === "vars" ? s.vars.map((v) => ({ insert: `$vars.${v.name}`, label: v.name })) : [],
      ),
    },
    {
      label: t("flow.v.apx"),
      values: [
        { insert: "$apx.project", label: t("flow.v.project") },
        { insert: "$apx.now", label: t("flow.v.now") },
        { insert: "$apx.run", label: t("flow.v.run") },
      ],
    },
  ];
  if (SECRET_FIELDS.has(field))
    groups.push({
      label: t("flow.v.secrets"),
      values: secrets.map((name) => ({ insert: `secret://${name}`, label: name, secret: true })),
    });
  return groups.filter((g) => g.values.length > 0);
}
