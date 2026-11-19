import { z } from "zod";
import { badRequest } from "../errors.ts";
import { qb, type Sql } from "./sql.ts";

const Pending = z.object({
  id: z.string().uuid(),
  agent: z.string(),
  source: z.string(),
  destination: z.string(),
  threads: z.array(z.string()),
});
const PREFIX = "agent-migration-pending:";
export function pendingMigrationsRepo(q: Sql) {
  const list = () =>
    q
      .all(qb.selectFrom("meta").select("value").where("key", "like", `${PREFIX}%`))
      .map((r) => Pending.parse(JSON.parse(r.value)));
  return {
    list,
    blocked(agent: string, thread: string) {
      return list().some((p) => p.agent === agent || p.threads.includes(thread));
    },
    reserve(value: z.infer<typeof Pending>) {
      const next = Pending.parse(value);
      if (
        list().some(
          (p) =>
            p.id !== next.id && [p.source, p.destination].some((id) => id === next.source || id === next.destination),
        )
      )
        throw badRequest("Finish the existing project move before starting another");
      q.run(
        qb
          .insertInto("meta")
          .values({ key: `${PREFIX}${next.id}`, value: JSON.stringify(next) })
          .onConflict((c) => c.column("key").doUpdateSet({ value: JSON.stringify(next) })),
      );
    },
    release(id: string) {
      q.run(qb.deleteFrom("meta").where("key", "=", `${PREFIX}${id}`));
    },
  };
}
