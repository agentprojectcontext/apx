// A variable may hold a secret's reference (`secret://name`) and nothing else. It stays a reference everywhere except
// where a step reads secrets itself (an HTTP header, a command's environment): there a `$vars.name` placeholder, once
// the text is parsed, stands for that reference as the owner's own text. Anywhere else the secret would travel as text,
// or its name would, so validation refuses it (DECISIONS.md#d-173).
import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { FlowVarIndex } from "./flow-expr.ts";
import { type FlowTemplatePart, parseFlowTemplate } from "./flow-template.ts";

/** `secret://name` references in owner text; a name is letters, digits and `_ - . / ~`. */
export const SECRET_REF = /secret:\/\/[A-Za-z0-9_.~/-]{1,200}/g;
const SECRET_ONLY = /^secret:\/\/[A-Za-z0-9_.~/-]{1,200}$/;
/** A variable named in a text no step parses as a template (a prompt, a command, an address, a query). */
const NAMED = /\$vars\.([A-Za-z_][A-Za-z0-9_]{0,63})/g;

/** Variables holding a secret, by name, and the reference each holds. */
export function flowSecretVars(graph: Pick<FlowGraph, "nodes">): Map<string, string> {
  const found = new Map<string, string>();
  for (const n of graph.nodes)
    if (n.kind === "vars")
      for (const v of n.vars)
        if (v.value.kind === "literal" && typeof v.value.value === "string" && SECRET_ONLY.test(v.value.value))
          found.set(v.name, v.value.value);
  return found;
}

/** A literal that mentions a secret without being only its reference: it would be read as plain text. */
export const looseSecretLiteral = (value: unknown) =>
  typeof value === "string" && value.includes("secret://") && !SECRET_ONLY.test(value);

/** The reference a part stands for when it is exactly `$vars.name` of a variable holding a secret. */
function heldSecret(part: FlowTemplatePart, secrets: ReadonlyMap<string, string>): string | undefined {
  if (!("binding" in part) || part.binding.kind !== "node" || part.binding.path.length !== 1) return undefined;
  const name = part.binding.path[0] ?? "";
  return part.source === `$vars.${name}` ? secrets.get(name) : undefined;
}

/** Parsed parts with each secret variable as a text part holding its reference, read like the owner's own text. */
export const withSecretParts = (parts: FlowTemplatePart[], secrets: ReadonlyMap<string, string>) =>
  parts.map((p) => {
    const ref = heldSecret(p, secrets);
    return ref ? { text: ref } : p;
  });

/**
 * A header's or a command variable's text, parsed, with its secret variables as their references; undefined when it
 * does not parse (validation says why).
 */
export function secretTemplate(
  text: string,
  vars: FlowVarIndex,
  secrets: ReadonlyMap<string, string>,
): FlowTemplatePart[] | undefined {
  try {
    return withSecretParts(parseFlowTemplate(text, vars), secrets);
  } catch {
    return undefined;
  }
}

/** The secret references such a text reads: in its own text and through its secret variables. */
export function secretRefs(text: string, vars: FlowVarIndex, secrets: ReadonlyMap<string, string>): string[] {
  const parts = secretTemplate(text, vars, secrets);
  if (!parts) return text.match(SECRET_REF) ?? [];
  return parts.flatMap((p) => ("text" in p ? (p.text.match(SECRET_REF) ?? []) : []));
}

/**
 * What a header or command variable stands for, for the key the owner approves: the text itself, or, when it uses a
 * secret variable, the text with that variable written as its reference (so changing the secret asks again).
 */
export function secretKeyText(text: string, vars: FlowVarIndex, secrets: ReadonlyMap<string, string>): string {
  let parts: FlowTemplatePart[];
  try {
    parts = parseFlowTemplate(text, vars);
  } catch {
    return text;
  }
  if (!parts.some((p) => heldSecret(p, secrets))) return text;
  return parts.map((p) => heldSecret(p, secrets) ?? ("text" in p ? p.text : p.source)).join("");
}

/** The secret variable a binding reads: `$vars.name`, `$steps.<vars step>.name`, or the whole step that sets it. */
export function secretVarRead(
  b: FlowBinding,
  graph: Pick<FlowGraph, "nodes">,
  secrets: ReadonlyMap<string, string>,
): string | undefined {
  if (b.kind !== "node") return undefined;
  const node = graph.nodes.find((n) => n.id === b.node);
  if (node?.kind !== "vars") return undefined;
  const held = node.vars.filter((v) => secrets.has(v.name)).map((v) => v.name);
  if (b.path.length === 0) return held[0];
  return held.find((name) => name === b.path[0]);
}

/** Secret variables named in texts no step fills (a prompt, a command, an address, a query). */
export function secretVarsNamed(text: string, secrets: ReadonlyMap<string, string>): string[] {
  return [...text.matchAll(NAMED)].flatMap((m) => (m[1] && secrets.has(m[1]) ? [m[1]] : []));
}

/** Texts of a step no step fills with values, where a variable's name would still travel. */
export function flowUnfilledTexts(node: FlowNode): string[] {
  switch (node.kind) {
    case "http":
      return [node.url];
    case "sql":
      return [node.query];
    case "cmd":
      return [node.command];
    case "agent":
      return [node.prompt, node.bot?.system ?? ""];
    case "llm":
      return [node.prompt];
    default:
      return [];
  }
}
