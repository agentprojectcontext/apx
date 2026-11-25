// Synced from apps/web/src/tasks/history.ts by scripts/sync-design-assets.mjs.
// A task's events as sentences: who (you, or an agent by name) and what changed, from where to where.
import type { TaskColumn, TaskEvent } from "../../../../packages/protocol/src/index.ts";

export type HistoryLine = {
  at: string;
  /** "owner", or the agent's id (its name and avatar are looked up by the caller). */
  by: string;
  /** What happened, ready to read after the author ("moved it from Pending to Review"). */
  key: HistoryKey;
  vars: Record<string, string>;
};

type HistoryKey =
  | "create"
  | "move"
  | "assign"
  | "unassign"
  | "comment"
  | "done"
  | "drop"
  | "reopen"
  | "kept"
  | "missed"
  | "renegotiate"
  | "priority"
  | "due"
  | "undue"
  | "project"
  | "plan"
  | "planStep"
  | "note"
  | "asked"
  | "edit";

type Names = {
  column: (id: string) => string;
  agent: (id: string) => string;
  project: (id: string | null) => string;
  priority: (p: string) => string;
  when: (iso: string) => string;
};

/** A plan's lines without their checklist marks: "- [~] Fix it" reads "Fix it". */
const planLines = (plan: string) =>
  plan
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+(\[[ ~xX]\]\s+)?/, "").trim())
    .filter(Boolean);

/** A note an agent left: who it asked for what, or its own words. */
function noteLine(note: string): { key: "asked" | "note"; vars: Record<string, string> } {
  const asked = /^asked (.+?) for: ([\s\S]+)$/.exec(note);
  return asked?.[1] && asked[2]
    ? { key: "asked", vars: { agent: asked[1], what: asked[2] } }
    : { key: "note", vars: { note } };
}

/**
 * Every event as one line; a move says where it came from, and a plan change which step it wrote, by replaying the
 * earlier ones.
 */
export function historyLines(events: readonly TaskEvent[], columns: readonly TaskColumn[], n: Names): HistoryLine[] {
  let status = columns[0]?.id ?? "";
  let plan: string[] | undefined;
  return events.map((e) => {
    const d = e.data as Record<string, unknown>;
    const line = (key: HistoryKey, vars: Record<string, string> = {}): HistoryLine => ({
      at: e.at,
      by: e.by,
      key,
      vars,
    });
    switch (e.op) {
      case "create":
        if (typeof d.status === "string") status = d.status;
        return line("create");
      case "move": {
        const from = status;
        if (typeof d.status === "string") status = d.status;
        return line("move", { from: n.column(from), to: n.column(status) });
      }
      case "assign":
        return typeof d.assignee === "string" ? line("assign", { agent: n.agent(d.assignee) }) : line("unassign");
      case "done":
        return line(d.outcome === "kept" ? "kept" : "done");
      case "drop":
        return line(d.outcome === "missed" ? "missed" : "drop");
      case "renegotiate":
        return line("renegotiate", { when: typeof d.to === "string" ? n.when(d.to) : "" });
      case "comment":
      case "reopen":
        return line(e.op);
      default:
        if (typeof d.priority === "string") return line("priority", { priority: n.priority(d.priority) });
        if ("due_at" in d)
          return typeof d.due_at === "string" ? line("due", { when: n.when(d.due_at) }) : line("undue");
        if ("project_id" in d) return line("project", { project: n.project((d.project_id as string | null) ?? null) });
        if (typeof d.plan === "string") {
          const before = plan;
          plan = planLines(d.plan);
          const step = before && plan.find((l) => !before.includes(l));
          return step ? line("planStep", { step }) : line("plan");
        }
        if (typeof d.note === "string" && d.note.trim()) {
          const { key, vars } = noteLine(d.note.trim());
          return line(key, vars);
        }
        return line("edit");
    }
  });
}
