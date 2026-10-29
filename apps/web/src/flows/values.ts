// What a step's template fields can insert, grouped for the picker (TemplateField): what arrived, earlier steps'
// results, variables, APX's own values and, only where the step resolves them itself, secrets (AGENTS.md rule 11).
import { DEFINITION_NODE } from "@apx/protocol/flow-shape";
import type { TemplateGroup } from "@apx/ui";
import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { MessageKey } from "../i18n/index.ts";
import { chainOrder, dotted } from "./graph-edit.ts";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Every field that takes placeholders; `varText` is a variable's value, `formula` a check's or a variable's. */
export type TemplateFieldKind =
  | "message"
  | "header"
  | "body"
  | "sqlValue"
  | "env"
  | "stdin"
  | "key"
  | "column"
  | "varText"
  | "formula";
/**
 * Fields whose secrets the step reads inside the core, right before it uses them: an HTTP header, a command's
 * environment, and a variable's value (it holds the reference, read where the variable is used in one of those).
 * Anywhere else (a message, a body, a model's prompt) a secret would travel as text, so none is offered
 * (DECISIONS.md#d-173).
 */
export const SECRET_FIELDS: ReadonlySet<TemplateFieldKind> = new Set(["header", "env", "varText"]);
/** A variable's value is either text it holds as it is (a secret's reference among them) or nothing else. */
const LITERAL_ONLY: ReadonlySet<TemplateFieldKind> = new Set(["varText"]);

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

/** A variable that holds a secret's reference and nothing else (D-173). */
export const holdsSecret = (v: { value: { kind: string; value?: unknown } }) =>
  v.value.kind === "literal" &&
  typeof v.value.value === "string" &&
  /^secret:\/\/[A-Za-z0-9_.~/-]+$/.test(v.value.value);

/** The table of the nearest save before `id` that names one: a read placed after it reads it first. */
export function savedTableBefore(graph: FlowGraph, id: string): string | undefined {
  return earlier(graph, id)
    .reverse()
    .find((n): n is Extract<FlowNode, { kind: "table_write" }> => n.kind === "table_write" && Boolean(n.table))?.table;
}

/** Fields of what arrived that other steps already read: the ones worth naming. */
function knownFields(graph: FlowGraph): string[] {
  const paths = new Set<string>();
  const add = (b: FlowBinding) => b.kind === "event" && b.path.length > 0 && paths.add(dotted(b.path));
  for (const n of graph.nodes) {
    if ("input" in n && typeof n.input === "object") add(n.input);
    if (n.kind === "table_write" && n.value) add(n.value);
    const texts =
      n.kind === "table_write"
        ? [n.key, ...(n.columns ?? []).map((c) => c.value)]
        : n.kind === "table_read"
          ? n.keys
          : [];
    for (const text of texts)
      for (const m of text.matchAll(/\$trigger((?:\.[A-Za-z0-9_-]+)+)/g)) if (m[1]) paths.add(m[1].slice(1));
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
  /** What the secrets group offers to do: save one, so the owner never meets an empty list. */
  secretAction?: TemplateGroup["action"],
  /** A project table's columns: a read's later steps are offered each one (DECISIONS.md#d-176). */
  columnsOf: (table: string) => readonly string[] = () => [],
): TemplateGroup[] {
  const webhook = graph.nodes.some((x) => x.kind === "webhook");
  const before = earlier(graph, n.id);
  const secretsHere = SECRET_FIELDS.has(field);
  const secretGroup: TemplateGroup = {
    label: t("flow.v.secrets"),
    values: secrets.map((name) => ({ insert: `secret://${name}`, label: name, secret: true })),
    ...(secretAction ? { action: secretAction } : {}),
  };
  if (LITERAL_ONLY.has(field)) return [secretGroup];
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
        .flatMap((s) => [
          {
            insert: ["$steps", s.id, ...(s.kind === "http" ? ["json"] : (RESULT[s.kind] ?? []))].join("."),
            label: s.label,
            hint:
              (s.kind === "table_read" || s.kind === "table_write") && s.table
                ? `${kindName(s.kind)} · ${s.table}`
                : kindName(s.kind),
          },
          // A read's columns, each its first row's value.
          ...(s.kind === "table_read" && s.table
            ? columnsOf(s.table).map((c) => ({ insert: `$steps.${s.id}.${c}`, label: c, hint: s.label }))
            : []),
        ]),
    },
    {
      label: t("flow.v.vars"),
      // A variable holding a secret only where the step reads secrets itself; elsewhere it would be refused.
      values: before.flatMap((s) =>
        s.kind === "vars"
          ? s.vars.flatMap((v) =>
              !holdsSecret(v)
                ? [{ insert: `$vars.${v.name}`, label: v.name }]
                : secretsHere
                  ? [{ insert: `$vars.${v.name}`, label: v.name, secret: true }]
                  : [],
            )
          : [],
      ),
    },
  ];
  // Formulas read what arrived, steps and variables, nothing of APX's own.
  if (field !== "formula")
    groups.push({
      label: t("flow.v.apx"),
      values: [
        { insert: "$apx.project", label: t("flow.v.project") },
        { insert: "$apx.now", label: t("flow.v.now") },
        { insert: "$apx.run", label: t("flow.v.run") },
      ],
    });
  if (secretsHere) groups.push(secretGroup);
  return groups.filter((g) => g.values.length > 0 || g.action);
}

/** A table name as people type it, made one the core takes: lowercase, no accents, `_` for anything else. */
export const tableName = (typed: string) =>
  typed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+/, "")
    .slice(0, 40);

/**
 * A read or save drawn from a Flow's definition keeps the Flow's own table, which has no name; any other step names
 * one of the project's tables before it can be saved.
 */
export const ownTable = (n: Pick<FlowNode, "id">) => n.id === DEFINITION_NODE.save || n.id === DEFINITION_NODE.read;
