// The ledger of messages APX meant to send the owner unasked (the interruption budget reads it): one row each, with
// what became of it. Kept in SQLite, pruned to the last 60 days.
import type { Nudge } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { NudgesTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const KEEP_DAYS = 60;

const toNudge = (r: Selectable<NudgesTable>): Nudge => ({
  id: r.id,
  at: r.at,
  kind: r.kind,
  text: r.text,
  ...opt("thread_id", r.thread_id),
  ...opt("project_id", r.project_id),
  state: r.state as Nudge["state"],
  ...opt("reason", r.reason),
  exempt: Boolean(r.exempt),
  ...(r.feedback === "up" || r.feedback === "down" ? { feedback: r.feedback } : {}),
});

/** An id for a nudge about to be sent, so its 👍/👎 buttons can name it. */
export const nudgeId = () => newId("ndg");

export type NudgeRow = Nudge & { hold_until?: string | undefined };

export function nudgesRepo({ one, all, run }: Sql) {
  return {
    add(n: Omit<NudgeRow, "id" | "at"> & { id?: string; at?: string }): Nudge {
      const id = n.id ?? nudgeId();
      run(
        qb.insertInto("nudges").values({
          id,
          at: n.at ?? now(),
          kind: n.kind,
          text: n.text,
          thread_id: n.thread_id ?? null,
          project_id: n.project_id ?? null,
          state: n.state,
          reason: n.reason ?? null,
          exempt: n.exempt ? 1 : 0,
          hold_until: n.hold_until ?? null,
        }),
      );
      return toNudge(one(qb.selectFrom("nudges").selectAll().where("id", "=", id)) as Selectable<NudgesTable>);
    },
    list(limit: number): Nudge[] {
      return all(qb.selectFrom("nudges").selectAll().orderBy("n", "desc").limit(limit)).map(toNudge);
    },
    /** Sent since `at` and counted against the cap. */
    countedSince(at: string): number {
      const r = one(
        qb
          .selectFrom("nudges")
          .select((eb) => eb.fn.countAll<number>().as("n"))
          .where("at", ">=", at)
          .where("state", "=", "sent")
          .where("exempt", "=", 0),
      );
      return Number(r?.n ?? 0);
    },
    /** When the last counted message about this project, or of this kind, went out. */
    lastSent(by: { project_id?: string | undefined; kind?: string | undefined }): string | undefined {
      let q = qb.selectFrom("nudges").select("at").where("state", "=", "sent").where("exempt", "=", 0);
      if (by.project_id) q = q.where("project_id", "=", by.project_id);
      if (by.kind) q = q.where("kind", "=", by.kind);
      return one(q.orderBy("at", "desc").limit(1))?.at;
    },
    /** Held messages whose wait is over, oldest first. */
    heldUntil(at: string): Nudge[] {
      return all(
        qb.selectFrom("nudges").selectAll().where("state", "=", "held").where("hold_until", "<=", at).orderBy("n"),
      ).map(toNudge);
    },
    settle(ids: string[], state: Nudge["state"], reason?: string): void {
      if (!ids.length) return;
      run(
        qb
          .updateTable("nudges")
          .set({ state, reason: reason ?? null })
          .where("id", "in", ids),
      );
    },
    get(id: string): Nudge | undefined {
      const r = one(qb.selectFrom("nudges").selectAll().where("id", "=", id));
      return r ? toNudge(r as Selectable<NudgesTable>) : undefined;
    },
    feedback(id: string, feedback: "up" | "down" | null, at: string): Nudge | undefined {
      run(
        qb
          .updateTable("nudges")
          .set({ feedback, feedback_at: feedback ? at : null })
          .where("id", "=", id),
      );
      return this.get(id);
    },
    /** How the owner rated this kind since `at`, and their latest rating. */
    ratings(kind: string, at: string): { up: number; down: number; last?: "up" | "down" } {
      const rows = all(
        qb
          .selectFrom("nudges")
          .select(["feedback"])
          .where("kind", "=", kind)
          .where("at", ">=", at)
          .where("feedback", "is not", null)
          .orderBy("feedback_at", "desc"),
      );
      const up = rows.filter((r) => r.feedback === "up").length;
      const last = rows[0]?.feedback;
      return { up, down: rows.length - up, ...(last === "up" || last === "down" ? { last } : {}) };
    },
    prune(): void {
      const before = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
      run(qb.deleteFrom("nudges").where("at", "<", before).where("state", "!=", "held"));
    },
  };
}
