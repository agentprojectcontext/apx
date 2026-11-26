import { ChatContinuation } from "@apx/protocol";
import { newId, qb, type Sql } from "./sql.ts";

export function continuationsRepo({ all, one, run }: Sql) {
  const get = (id: string) => {
    const row = one(qb.selectFrom("chat_continuations").selectAll().where("id", "=", id));
    return row
      ? {
          value: ChatContinuation.parse({
            ...row,
            condition: JSON.parse(row.condition),
            project_id: row.project_id ?? undefined,
            run_id: row.run_id ?? undefined,
            reason: row.reason ?? undefined,
          }),
          authority: row.authority,
        }
      : undefined;
  };
  return {
    get,
    list(thread?: string, active = false): ChatContinuation[] {
      let q = qb.selectFrom("chat_continuations").selectAll();
      if (thread) q = q.where("thread_id", "=", thread);
      if (active) q = q.where("state", "in", ["pending", "admitted"]);
      return all(q.orderBy("created_at", "desc").limit(200)).map((row) =>
        ChatContinuation.parse({
          ...row,
          condition: JSON.parse(row.condition),
          project_id: row.project_id ?? undefined,
          run_id: row.run_id ?? undefined,
          reason: row.reason ?? undefined,
        }),
      );
    },
    create(value: Omit<ChatContinuation, "id" | "state">, authority: string): ChatContinuation {
      const id = newId("cont");
      run(
        qb.insertInto("chat_continuations").values({
          ...value,
          id,
          state: "pending",
          condition: JSON.stringify(value.condition),
          project_id: value.project_id ?? null,
          run_id: null,
          reason: null,
          authority,
        }),
      );
      return { ...value, id, state: "pending" };
    },
    change(
      id: string,
      from: ChatContinuation["state"],
      state: ChatContinuation["state"],
      opts: { run_id?: string; reason?: string } = {},
    ) {
      return (
        run(
          qb
            .updateTable("chat_continuations")
            .set({ state, ...(opts.run_id ? { run_id: opts.run_id } : {}), reason: opts.reason ?? null })
            .where("id", "=", id)
            .where("state", "=", from),
        ) === 1
      );
    },
  };
}
