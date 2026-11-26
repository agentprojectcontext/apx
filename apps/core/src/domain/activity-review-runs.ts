// The history of activity reviews: one row per review that read conversations, with the proposals it left as tasks.
// What became of each proposal is read from its task, so the history never disagrees with Tasks.
import type { ActivityReviewOutcome, ActivityReviewRun, Task } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { ActivityReviewRunsTable } from "../db/schema.ts";
import { newId, opt, qb, type Sql } from "./sql.ts";
import type { Store } from "./store.ts";

type RunState = ActivityReviewRun["state"];
type Proposed = { task: string; title: string };
const KEEP = 200;

const proposedOf = (text: string): Proposed[] => {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v)
      ? v.flatMap((p: { task?: unknown; title?: unknown }) =>
          typeof p?.task === "string" && typeof p.title === "string" ? [{ task: p.task, title: p.title }] : [],
        )
      : [];
  } catch {
    return [];
  }
};

export function activityReviewRunsRepo({ all, run }: Sql) {
  return {
    /** A review starts reading: when it ran, from when, and how many chats and owner messages it sends. */
    start(r: { at: string; since: string; chats: number; messages: number }): string {
      const id = newId("arv");
      run(qb.insertInto("activity_review_runs").values({ id, ...r, state: "working" }));
      const old = qb.selectFrom("activity_review_runs").select("id").orderBy("at", "desc").offset(KEEP).limit(-1);
      run(qb.deleteFrom("activity_review_runs").where("id", "in", old));
      return id;
    },
    finish(id: string, state: Exclude<RunState, "working">, proposals: Proposed[] = []): void {
      run(
        qb
          .updateTable("activity_review_runs")
          .set({ state, proposals: JSON.stringify(proposals) })
          .where("id", "=", id)
          .where("state", "=", "working"),
      );
    },
    /** Reviews still reading when the core stopped: their outcome is unknown. */
    interrupted(state: "uncertain" | "cancelled"): void {
      run(qb.updateTable("activity_review_runs").set({ state }).where("state", "=", "working"));
    },
    page(limit: number, before?: string): Selectable<ActivityReviewRunsTable>[] {
      let q = qb.selectFrom("activity_review_runs").selectAll();
      if (before) q = q.where("at", "<", before);
      return all(q.orderBy("at", "desc").orderBy("id", "desc").limit(limit));
    },
  };
}

function outcomeOf(task: Task | undefined): ActivityReviewOutcome {
  if (!task) return "deleted";
  if (task.state === "done") return "done";
  if (task.state === "dropped") return "dropped";
  return task.proposed ? "pending" : "accepted";
}

/** A page of the history, newest first; `next` is the `before` of the following page. */
export function activityReviewHistory(
  store: Store,
  { limit, before }: { limit: number; before?: string | undefined },
): { runs: ActivityReviewRun[]; next?: string } {
  const rows = store.activityReviewRuns.page(limit + 1, before);
  const runs = rows.slice(0, limit).map(
    (r): ActivityReviewRun => ({
      id: r.id,
      at: r.at,
      ...opt("since", r.since),
      state: r.state as RunState,
      ...(r.chats === null ? {} : { chats: r.chats }),
      ...(r.messages === null ? {} : { messages: r.messages }),
      proposals: proposedOf(r.proposals).map((p) => {
        const task = store.tasks.get(p.task);
        return {
          task_id: p.task,
          title: task?.title ?? p.title,
          ...opt("project_id", task?.project_id),
          outcome: outcomeOf(task),
        };
      }),
    }),
  );
  const last = runs.at(-1);
  return { runs, ...(rows.length > limit && last ? { next: last.at } : {}) };
}
