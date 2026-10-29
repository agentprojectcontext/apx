// Text with placeholders for messages, HTTP headers and bodies, SQL parameters and a command's environment and input:
// `$trigger.a.b` reads the payload, `$steps.<step>.a.b` an earlier step's output, `$vars.name` a variable,
// `$apx.project|now|run` what APX knows of the run, `$$` is a dollar sign. Each placeholder is an ordinary binding, so validation, ancestors and redaction are the same as for any
// step's input; nothing is evaluated.
import type { FlowBinding } from "../../../../packages/protocol/src/flow-graph.ts";
import type { FlowVarIndex } from "./flow-expr.ts";

/** What APX knows of a run: its project's name, when the step ran (ISO) and the run's id. */
export const FLOW_APX = ["project", "now", "run"] as const;
export type FlowApx = Record<(typeof FLOW_APX)[number], string>;
export type FlowTemplatePart =
  | { text: string }
  | { binding: FlowBinding; source: string }
  | { apx: keyof FlowApx; source: string };

const PLACEHOLDER = /\$\$|\$(trigger|steps|vars|apx)((?:\.[A-Za-z0-9_-]+)*)/g;
const MAX_PLACEHOLDERS = 32;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Splits a template into literal text and bindings; throws on a placeholder that names no step, a variable no step
 * sets (`vars` says where each is set) or a bad field.
 */
export function parseFlowTemplate(template: string, vars: FlowVarIndex = new Map()): FlowTemplatePart[] {
  const parts: FlowTemplatePart[] = [];
  let last = 0;
  let text = "";
  let count = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    text += template.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "$$") {
      text += "$";
      continue;
    }
    const path = (m[2] ?? "").split(".").filter(Boolean);
    if (m[1] === "apx") {
      const name = FLOW_APX.find((n) => n === path[0]);
      if (!name || path.length !== 1) throw new Error("Flow template names no APX value");
      if (++count > MAX_PLACEHOLDERS) throw new Error("Flow template has too many placeholders");
      if (text) parts.push({ text });
      text = "";
      parts.push({ apx: name, source: m[0] });
      continue;
    }
    if (path.length > 17 || path.some((s) => FORBIDDEN.has(s) || s.length > 128))
      throw new Error("Flow template field is not allowed");
    let binding: FlowBinding;
    if (m[1] === "trigger") binding = { kind: "event", path };
    else if (m[1] === "vars") {
      const node = vars.get(path[0] ?? "");
      if (!node) throw new Error("Flow template names no variable");
      binding = { kind: "node", node, path };
    } else {
      const [node, ...rest] = path;
      if (!node || !/^[A-Za-z0-9_-]{1,100}$/.test(node)) throw new Error("Flow template names no step");
      binding = { kind: "node", node, path: rest };
    }
    if (++count > MAX_PLACEHOLDERS) throw new Error("Flow template has too many placeholders");
    if (text) parts.push({ text });
    text = "";
    parts.push({ binding, source: m[0] });
  }
  text += template.slice(last);
  if (text) parts.push({ text });
  return parts;
}

export const flowTemplateBindings = (template: string, vars?: FlowVarIndex): FlowBinding[] =>
  parseFlowTemplate(template, vars).flatMap((p) => ("binding" in p ? [p.binding] : []));

/** Nothing to tell: absent, null, blank text, an empty list or an empty object. */
export function emptyFlowValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** A bound value as text: strings as they are, anything else as JSON. */
export const flowValueText = (value: unknown): string =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);

/**
 * Fills a template. `resolve` returns a binding's value or throws when it is unavailable; `missing: "empty"` reads an
 * unavailable field as empty instead. `literal` rewrites literal text only (where secret references may be read),
 * never a bound value; `bound` rewrites bound values only. Returns the text and whether every placeholder came out empty.
 */
export function renderFlowTemplate(
  parts: FlowTemplatePart[],
  resolve: (binding: FlowBinding) => unknown,
  o: {
    missing?: "throw" | "empty";
    literal?: (text: string) => string;
    bound?: (text: string) => string;
    /** APX's own values for `$apx.…`; absent, they come out empty. */
    apx?: FlowApx | undefined;
  } = {},
): { text: string; empty: boolean } {
  let text = "";
  let placeholders = 0;
  let filled = 0;
  for (const part of parts) {
    if ("text" in part) {
      text += o.literal ? o.literal(part.text) : part.text;
      continue;
    }
    if ("apx" in part) {
      text += o.bound ? o.bound(o.apx?.[part.apx] ?? "") : (o.apx?.[part.apx] ?? "");
      continue;
    }
    placeholders++;
    let value: unknown;
    try {
      value = resolve(part.binding);
    } catch (err) {
      if (o.missing !== "empty") throw err;
      value = undefined;
    }
    if (!emptyFlowValue(value)) filled++;
    text += o.bound ? o.bound(flowValueText(value)) : flowValueText(value);
  }
  return { text, empty: placeholders > 0 && filled === 0 };
}
