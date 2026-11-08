// What the model saw, when two chats of one person become one (threads.ts joinChats).
import { qb, type Sql } from "./sql.ts";

/**
 * Both chats' model logs as the kept chat's one log, in the order their turns ran: a turn's entries stay together, and
 * entries no turn wrote stay after the ones before them.
 */
export function joinModelLogs({ all, run }: Pick<Sql, "all" | "run">, gone: string, kept: string): void {
  const rows = all(
    qb
      .selectFrom("model_log as l")
      .leftJoin("runs as r", "r.id", "l.run_id")
      .select(["l.thread_id", "l.seq", "r.started_at"])
      .where("l.thread_id", "in", [gone, kept])
      .orderBy("l.seq"),
  );
  const timed = (thread: string) => {
    let at = "";
    return rows
      .filter((r) => r.thread_id === thread)
      .map((r) => {
        at = r.started_at ?? at;
        return { ...r, at };
      });
  };
  const a = timed(kept);
  const b = timed(gone);
  const order: typeof a = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const x = a[i];
    const y = b[j];
    if (x && (!y || x.at <= y.at)) {
      order.push(x);
      i++;
    } else if (y) {
      order.push(y);
      j++;
    } else break;
  }
  // Negative first, so no two entries ever share a place in the kept chat while they are renumbered.
  for (const [k, r] of order.entries())
    run(
      qb
        .updateTable("model_log")
        .set({ thread_id: kept, seq: -(k + 1) })
        .where("thread_id", "=", r.thread_id)
        .where("seq", "=", r.seq),
    );
  run(
    qb
      .updateTable("model_log")
      .set((eb) => ({ seq: eb.neg(eb.ref("seq")) }))
      .where("thread_id", "=", kept)
      .where("seq", "<", 0),
  );
}
