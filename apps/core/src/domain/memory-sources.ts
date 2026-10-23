import { sql as raw } from "kysely";
import { qb, type Sql } from "./sql.ts";

/** The owner speaking, as ownerOrigin (runs.ts) reads it: from the app or on a channel as the owner. */
const OWNER_ORIGIN = (input: "input" | "r.input") =>
  raw<boolean>`(json_extract(${raw.ref(input)}, '$.origin.kind') = 'user' OR (json_extract(${raw.ref(input)}, '$.origin.kind') = 'channel' AND json_extract(${raw.ref(input)}, '$.origin.role') = 'owner'))`;

/** The original owner message is linked at admission; older turns resolve their last matching preceding message. */
export function memorySourcesRepo({ one, all }: Sql) {
  const joined = () =>
    qb
      .selectFrom("runs as r")
      .innerJoin("messages as m", "m.thread_id", "r.thread_id")
      .where(OWNER_ORIGIN("r.input"))
      .where(raw<string>`json_extract(m.author, '$.kind')`, "=", "user")
      .where(raw<boolean>`(json_extract(r.input, '$.origin.message_id') = m.id OR
      (json_extract(r.input, '$.origin.message_id') IS NULL AND json_extract(m.parts, '$[0].text') = json_extract(r.input, '$.text') AND m.created_at <= r.started_at))`);
  return {
    forRun(runId: string): string[] {
      const linked = one(
        qb
          .selectFrom("runs")
          .select(raw<string | null>`json_extract(input, '$.origin.message_id')`.as("message"))
          .where("id", "=", runId),
      );
      if (linked?.message) return [linked.message];
      return all(joined().select("m.id").where("r.id", "=", runId).orderBy("m.seq", "desc").limit(1)).map((r) => r.id);
    },
    runFor(messageId: string): string | undefined {
      const linked = one(
        qb
          .selectFrom("runs")
          .select("id")
          .where(raw<string>`json_extract(input, '$.origin.message_id')`, "=", messageId)
          .where(OWNER_ORIGIN("input")),
      );
      if (linked) return linked.id;
      return one(joined().select("r.id").where("m.id", "=", messageId).orderBy("r.started_at").limit(1))?.id;
    },
  };
}
