import { flowCases } from "@apx/protocol/flow-cases";
import type { useT } from "../i18n/index.ts";
import { type FlowGraph, type FlowNode, STEP } from "./steps.tsx";
import { ownTable } from "./values.ts";

/** A new flow's id from its name: a readable slug and a short random tail. */
export const slug = (name: string) =>
  `${
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "flow"
  }-${Math.random().toString(36).slice(2, 6)}`;

/** The step that keeps a graph from being saved, if a required setting is still blank. */
export function blank(n: FlowNode): boolean {
  switch (n.kind) {
    case "condition": {
      const cases = flowCases(n);
      return (
        cases.some((c) => c.match.kind === "expr" && !c.match.expr.trim()) ||
        (cases.some((c) => c.match.kind === "equals") && n.input.kind === "event" && n.input.path.length === 0)
      );
    }
    case "vars":
      return n.vars.some((v) => !v.name || (v.value.kind === "expr" && !v.value.expr.trim()));
    case "js":
      return !n.code.trim();
    case "sql":
      return !n.database.trim() || !n.query.trim();
    case "cmd":
      return !n.command.trim();
    case "table_read":
      return (!n.table && !ownTable(n)) || (n.latest === undefined && !n.keys.some((k) => k.trim()));
    case "table_write":
      return (!n.table && !ownTable(n)) || !n.key.trim();
    case "agent":
      return (n.bot ? !n.bot.name.trim() || !n.bot.system.trim() : !n.agent) || !n.prompt.trim();
    case "routine":
      return !n.routine;
    case "llm":
      return !n.model || !n.prompt.trim();
    case "schedule":
      return !n.cron.trim();
    case "notify":
      return !n.channel || (n.to.kind === "contact" ? !n.to.person : !n.to.room) || !n.text.trim();
    case "http":
      return !/^https?:\/\/[^/\s]+/.test(n.url.trim());
    default:
      return false;
  }
}
/** Labels the graph schema needs, and blank lines left in key lists. */
export const tidy = (g: FlowGraph, t: ReturnType<typeof useT>): FlowGraph => ({
  ...g,
  nodes: g.nodes.map((n) => {
    const label = n.label.trim() || t(STEP[n.kind].label);
    if (n.kind === "table_read") return { ...n, label, keys: n.keys.map((k) => k.trim()).filter(Boolean) };
    if (n.kind === "table_write") return { ...n, label, key: n.key.trim() };
    if (n.kind === "http") return { ...n, label, url: n.url.trim(), body: n.method === "GET" ? "" : n.body };
    if (n.kind === "condition" && n.cases)
      return { ...n, label, cases: n.cases.map((c) => ({ ...c, label: c.label.trim() })) };
    if (n.kind === "sql") return { ...n, label, database: n.database.trim() };
    if (n.kind === "cmd") return { ...n, label, command: n.command.trim() };
    return { ...n, label };
  }),
});
