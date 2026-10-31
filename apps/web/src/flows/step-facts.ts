// A step's settings read back in words, for the chat's view of a Flow: the editor's field names with what each holds,
// nothing to change.
import { flowCases } from "@apx/protocol/flow-cases";
import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { MessageKey } from "../i18n/index.ts";
import { rulesText } from "./compare.ts";
import { branchesOf, hookVerbs, literal } from "./graph-edit.ts";
import { templateOfBinding } from "./values.ts";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** One setting: its name as the editor shows it and what it holds; `code` is shown as typed, in a fixed font. */
export type Fact = { label: string; value: string; code?: boolean };

/** Names the screen knows: the drawing's steps, and the agents, routines, people, models and schedules by name. */
export type FactsContext = {
  graph: Pick<FlowGraph, "nodes">;
  /** Who an AI, routine or notify step works with, by name. */
  who: (n: FlowNode) => string;
  /** A model's name for a model reference, never the reference itself. */
  modelName: (ref: string) => string;
  /** A schedule as people say it, or its cron. */
  scheduleName: (cron: string) => string;
};

/** Every setting of step `n` that holds something, in the order the editor's card shows them. */
export function stepFacts(n: FlowNode, ctx: FactsContext, t: T): Fact[] {
  // A whole value: everything that arrived is said in words, anything else as its placeholder.
  const whole = (label: string, b: FlowBinding | undefined): Fact => {
    const text = b ? templateOfBinding(b, ctx.graph) : "";
    return text === "$trigger" ? { label, value: t("flow.v.everything") } : { label, value: text, code: true };
  };
  const receives = (b: FlowBinding) => whole(t("flow.f.receives"), b);
  const yesNo = (on: boolean) => t(on ? "flow.f.yes" : "flow.f.no");
  const lines = (list: { name: string; value: string }[], sep: string) =>
    list.map((x) => `${x.name}${sep}${x.value}`).join("\n");
  const facts = ((): Fact[] => {
    switch (n.kind) {
      case "webhook":
        return [{ label: t("flow.f.method"), value: hookVerbs(n) }];
      case "schedule": {
        const named = ctx.scheduleName(n.cron);
        return [
          { label: t("flow.f.often"), value: named },
          ...(named !== n.cron ? [{ label: t("flow.f.cron"), value: n.cron, code: true }] : []),
        ];
      }
      case "condition": {
        const ways = branchesOf(n, t);
        const cases = flowCases(n).map((c, i): Fact => {
          const label = ways[i]?.label ?? c.id;
          if (c.match.kind === "expr") return { label, value: c.match.expr, code: true };
          if (c.match.kind === "all" || c.match.kind === "any") return { label, value: rulesText(c.match, t) };
          return { label, value: `${templateOfBinding(n.input, ctx.graph)} = ${literal(c.match.value)}`, code: true };
        });
        return [...cases, { label: ways.at(-1)?.label ?? "", value: t("flow.f.otherwiseHint") }];
      }
      case "vars":
        return n.vars.map((v) => ({
          label: v.name,
          value: v.value.kind === "expr" ? v.value.expr : literal(v.value.value),
          code: true,
        }));
      case "js":
        return [{ label: t("flow.f.code"), value: n.code, code: true }, receives(n.input)];
      case "sql":
        return [
          { label: t("flow.f.database"), value: n.database, code: true },
          { label: t("flow.f.readOnly"), value: yesNo(n.mode === "read") },
          { label: t("flow.f.query"), value: n.query, code: true },
          { label: t("flow.f.values"), value: lines(n.params, ": "), code: true },
        ];
      case "cmd":
        return [
          { label: t("flow.f.command"), value: n.command, code: true },
          { label: t("flow.f.env"), value: lines(n.env, "="), code: true },
          { label: t("flow.f.stdin"), value: n.stdin, code: true },
          { label: t("flow.f.goOn"), value: yesNo(n.continueOnError) },
        ];
      case "table_read":
        return [
          { label: t("flow.tbl.table"), value: n.table ?? t("flow.tbl.own") },
          n.latest
            ? { label: t("flow.tbl.latest"), value: String(n.latest) }
            : { label: t("flow.f.key"), value: n.keys.filter(Boolean).join("\n"), code: true },
          { label: t("flow.tbl.brings"), value: n.columns?.join(", ") ?? "" },
        ];
      case "table_write":
        return [
          { label: t("flow.tbl.table"), value: n.table ?? t("flow.tbl.own") },
          { label: t("flow.f.key"), value: n.key, code: true },
          n.columns
            ? { label: t("flow.tbl.saves"), value: lines(n.columns, ": "), code: true }
            : whole(t("flow.f.saveWhat"), n.value),
        ];
      case "agent":
        return [
          n.bot ? { label: t("flow.ai.botName"), value: n.bot.name } : { label: t("flow.f.agent"), value: ctx.who(n) },
          ...(n.bot ? [{ label: t("flow.ai.system"), value: n.bot.system }] : []),
          { label: t("flow.f.model"), value: n.model ? ctx.modelName(n.model) : "" },
          { label: t("flow.f.task"), value: n.prompt },
          receives(n.input),
        ];
      case "routine":
        return [{ label: t("flow.f.routine"), value: ctx.who(n) }, receives(n.input)];
      case "llm":
        return [
          { label: t("flow.f.model"), value: n.model ? ctx.modelName(n.model) : "" },
          { label: t("flow.f.task"), value: n.prompt },
          receives(n.input),
        ];
      case "notify":
        return [
          { label: t("flow.f.to"), value: ctx.who(n) },
          { label: t("flow.f.message"), value: n.text },
          { label: t("flow.f.onlyIf"), value: yesNo(n.onlyIfContent) },
        ];
      case "http":
        return [
          { label: t("flow.f.method"), value: n.method },
          { label: t("flow.f.address"), value: n.url, code: true },
          { label: t("flow.f.headers"), value: lines(n.headers, ": "), code: true },
          { label: t("flow.f.body"), value: n.body, code: true },
        ];
    }
  })();
  return facts.filter((f) => f.value.trim());
}

/** Where a step goes on to, with the way out of a check each connection leaves by. */
export function nextSteps(graph: FlowGraph, n: FlowNode, t: T): { id: string; label: string; when?: string }[] {
  const ways = n.kind === "condition" ? branchesOf(n, t) : undefined;
  return graph.edges
    .filter((e) => e.source === n.id)
    .map((e) => {
      const label = graph.nodes.find((x) => x.id === e.target)?.label ?? e.target;
      const when = ways && (ways.find((b) => b.id === (e.when ?? "yes"))?.label ?? e.when);
      return when ? { id: e.target, label, when } : { id: e.target, label };
    });
}
