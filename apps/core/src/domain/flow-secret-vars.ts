// A variable may hold a secret's reference (`secret://name`) and nothing else. It stays a reference everywhere except
// where a step reads secrets itself (an HTTP header, a command's environment): there `$vars.name` is the owner's own
// text for that reference. Anywhere else the secret would travel as text, so validation refuses it (DECISIONS.md#d-173).
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";

const SECRET_ONLY = /^secret:\/\/[A-Za-z0-9_.~/-]{1,200}$/;
/** `$$` is a dollar sign; `$vars.name` with no field after it is the variable itself. */
const VAR_USE = /\$\$|\$vars\.([A-Za-z_][A-Za-z0-9_]{0,63})(?![A-Za-z0-9_.-])/g;

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

/** The secret variables a text uses. */
export function secretVarUses(text: string, secrets: ReadonlyMap<string, string>): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(VAR_USE)) if (m[1] && secrets.has(m[1])) names.add(m[1]);
  return [...names];
}

/** The text with each secret variable written as the reference it holds. */
export const inlineSecretVars = (text: string, secrets: ReadonlyMap<string, string>) =>
  secrets.size ? text.replace(VAR_USE, (all, name?: string) => (name && secrets.get(name)) || all) : text;

/** An HTTP step's headers or a command's environment with secret variables written as their references. */
export function withSecretVars<N extends FlowNode>(node: N, secrets: ReadonlyMap<string, string>): N {
  if (!secrets.size) return node;
  if (node.kind === "http")
    return { ...node, headers: node.headers.map((h) => ({ ...h, value: inlineSecretVars(h.value, secrets) })) };
  if (node.kind === "cmd")
    return { ...node, env: node.env.map((e) => ({ ...e, value: inlineSecretVars(e.value, secrets) })) };
  return node;
}

/** Every text of a step where a secret would leave as text: messages, bodies, prompts, keys, formulas. */
export function flowPlainTexts(node: FlowNode): string[] {
  switch (node.kind) {
    case "notify":
      return [node.text];
    case "http":
      return [node.url, node.body];
    case "sql":
      return [node.query, ...node.params.map((p) => p.value)];
    case "cmd":
      return [node.command, node.stdin];
    case "table_read":
      return node.keys;
    case "table_write":
      return [node.key];
    case "agent":
      return [node.prompt, node.bot?.system ?? ""];
    case "llm":
      return [node.prompt];
    case "condition":
      return (node.cases ?? []).flatMap((c) => (c.match.kind === "expr" ? [c.match.expr] : []));
    case "vars":
      return node.vars.flatMap((v) => (v.value.kind === "expr" ? [v.value.expr] : []));
    default:
      return [];
  }
}
