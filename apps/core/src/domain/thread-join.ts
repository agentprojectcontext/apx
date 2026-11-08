// What else goes with a chat when two chats of one person become one (threads.ts joinChats).
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

/**
 * Everything else that points at the removed chat points at the kept one: turns, files, memory, a draft or a message
 * held for the hours still waiting, a flow's link (which would otherwise refuse the removal).
 */
export function moveChatRows(
  { one, run }: Pick<Sql, "one" | "run">,
  gone: { id: string; address: string },
  kept: { id: string; address: string },
): void {
  for (const table of [
    "runs",
    "media",
    "jobs",
    "notifications",
    "memory_work",
    "memory_episodes",
    "memory_exclusions",
    "memories",
    "suggestions",
    "pending_inputs",
    "routine_runs",
    "outbox",
    "surfaces",
    "nudges",
    "aux_calls",
    "flow_events",
    "flow_graph_nodes",
  ] as const)
    run(qb.updateTable(table).set({ thread_id: kept.id }).where("thread_id", "=", gone.id));
  const held = one(qb.selectFrom("channel_held").selectAll().where("thread_id", "=", gone.id));
  if (!held) return;
  run(qb.deleteFrom("channel_held").where("thread_id", "=", gone.id));
  const address = (a: string) => (a === gone.address ? kept.address : a);
  const waiting = one(qb.selectFrom("channel_held").select("since").where("thread_id", "=", kept.id));
  // One wait per chat, since the earliest message that waits; answered under the address the chat goes on with.
  run(
    qb
      .insertInto("channel_held")
      .values({ ...held, thread_id: kept.id, conversation: kept.address, sender: address(held.sender) })
      .onConflict((c) =>
        c
          .column("thread_id")
          .doUpdateSet({ since: waiting && waiting.since < held.since ? waiting.since : held.since }),
      ),
  );
}
