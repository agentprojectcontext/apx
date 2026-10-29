// What a step still needs before its drawing can run: the editor, `flows.validate` and publishing ask the same thing
// (DECISIONS.md#d-177). Type imports only besides plain helpers: the panel loads this without zod.
import { flowCases, flowComparisonGap } from "./flow-cases.ts";
import type { FlowDraftGraph, FlowDraftNode } from "./flow-graph.ts";

const empty = (text: string | undefined) => !text?.trim();

/**
 * The first setting a step still needs, by its field's name (`code`, `prompt`, `table`…), or undefined when the step
 * is complete. A draft may keep steps like this; a drawing that runs may not.
 */
export function flowStepGap(n: FlowDraftNode): string | undefined {
  switch (n.kind) {
    case "schedule":
      return empty(n.cron) ? "cron" : undefined;
    case "condition": {
      const cases = flowCases(n);
      if (cases.some((c) => c.match.kind === "expr" && empty(c.match.expr))) return "cases";
      // A comparison with no field, nothing to compare with, or a value its type can't read (DECISIONS.md#d-180).
      if (
        cases.some((c) => (c.match.kind === "all" || c.match.kind === "any") && c.match.rules.some(flowComparisonGap))
      )
        return "cases";
      const equals = cases.some((c) => c.match.kind === "equals");
      return equals && n.input.kind === "event" && n.input.path.length === 0 ? "input" : undefined;
    }
    case "vars":
      return n.vars.some((v) => !v.name || (v.value.kind === "expr" && empty(v.value.expr))) ? "vars" : undefined;
    case "js":
      return empty(n.code) ? "code" : undefined;
    case "sql":
      if (empty(n.database)) return "database";
      if (empty(n.query)) return "query";
      return n.params.some((p) => !p.name) ? "params" : undefined;
    case "cmd":
      if (empty(n.command)) return "command";
      return n.env.some((e) => !e.name) ? "env" : undefined;
    case "table_read":
      // Without a table, a read or a save uses the Flow's own (DECISIONS.md#d-173).
      return n.latest === undefined && !n.keys.some((k) => k.trim()) ? "keys" : undefined;
    case "table_write":
      if (empty(n.key)) return "key";
      return n.columns?.some((c) => !c.name) ? "columns" : undefined;
    case "agent":
      if (n.bot) {
        if (empty(n.bot.name) || empty(n.bot.system)) return "bot";
      } else if (!n.agent) return "agent";
      return empty(n.prompt) ? "prompt" : undefined;
    case "routine":
      return n.routine ? undefined : "routine";
    case "llm":
      if (!n.model) return "model";
      return empty(n.prompt) ? "prompt" : undefined;
    case "notify":
      if (!n.channel) return "channel";
      if (n.to.kind === "contact" ? !n.to.person : empty(n.to.room)) return "to";
      return empty(n.text) ? "text" : undefined;
    case "http":
      if (!/^https?:\/\/[^/\s]+/.test(n.url.trim())) return "url";
      return n.headers.some((h) => !h.name) ? "headers" : undefined;
    default:
      return undefined;
  }
}

/** Each step of a drawing that still needs a setting, with that setting, in the drawing's order. */
export function flowGraphGaps(graph: Pick<FlowDraftGraph, "nodes">): { node: FlowDraftNode; field: string }[] {
  return graph.nodes.flatMap((node) => {
    const field = flowStepGap(node);
    return field ? [{ node, field }] : [];
  });
}
