// Messages a Flow sent as the owner and requests that change something, kept a day for their hourly limits
// (DECISIONS.md#d-169).
import type { Db } from "../db/db.ts";
import { qb, sql } from "./sql.ts";

const KEPT_MS = 24 * 3600_000;
export type FlowSendKind = "message" | "request";

export function flowSendsRepo(db: Db) {
  const { one, run } = sql(db);
  return {
    /** How many of a kind it sent since `since`. */
    count(flow: string, kind: FlowSendKind, since: Date): number {
      return Number(
        one(
          qb
            .selectFrom("flow_sends")
            .select((e) => e.fn.countAll<number>().as("n"))
            .where("flow_id", "=", flow)
            .where("kind", "=", kind)
            .where("at", ">=", since.toISOString()),
        )?.n ?? 0,
      );
    },
    add(flow: string, kind: FlowSendKind, at: Date): void {
      run(qb.deleteFrom("flow_sends").where("at", "<", new Date(at.getTime() - KEPT_MS).toISOString()));
      run(qb.insertInto("flow_sends").values({ flow_id: flow, kind, at: at.toISOString() }));
    },
  };
}
