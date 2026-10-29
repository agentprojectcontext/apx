import type { useT } from "../i18n/index.ts";
import { type FlowGraph, STEP } from "./steps.tsx";

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
