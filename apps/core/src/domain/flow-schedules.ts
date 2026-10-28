// When schedule Flows tick. Each one keeps `since`, the moment its next time is counted from: the tick that admits
// a run moves it to that moment, so times missed while the core was off run once, not once each. Off, a Flow keeps
// none (domain/flows.ts deletes it): turned on again it counts from then and owes nothing.
import { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import type { Db } from "../db/db.ts";
import { nextCron, parseCron } from "./schedule.ts";
import { qb, sql } from "./sql.ts";

export type ScheduledFlow = { flow: string; cron: string };

export function flowSchedulesRepo(db: Db) {
  const { one, all, run } = sql(db);
  const api = {
    /** Every Flow whose published drawing starts on a schedule, on or off. */
    all(): (ScheduledFlow & { enabled: boolean })[] {
      return all(
        qb
          .selectFrom("flows as f")
          .innerJoin("flow_graph_drafts as d", "d.flow_id", "f.id")
          .innerJoin("flow_graph_revisions as r", (j) =>
            j.onRef("r.flow_id", "=", "d.flow_id").onRef("r.revision", "=", "d.published_revision"),
          )
          .select(["f.id", "f.enabled", "r.graph"])
          .orderBy("f.id"),
      ).flatMap((row) => {
        const trigger = FlowGraph.parse(JSON.parse(row.graph)).nodes.find((n) => n.kind === "schedule");
        return trigger?.kind === "schedule"
          ? [{ flow: row.id, cron: trigger.cron, enabled: Boolean(row.enabled) }]
          : [];
      });
    },
    since(flow: string): string | undefined {
      return one(qb.selectFrom("flow_schedules").select("since").where("flow_id", "=", flow))?.since;
    },
    /** From now on: the first tick of a Flow just turned on (or published with a schedule) owes nothing before it. */
    start(flow: string, at: Date): void {
      run(
        qb
          .insertInto("flow_schedules")
          .values({ flow_id: flow, since: at.toISOString() })
          .onConflict((c) => c.column("flow_id").doNothing()),
      );
    },
    /** The time is spent: the next one is counted from `at`. */
    advance(flow: string, at: Date): void {
      run(qb.updateTable("flow_schedules").set({ since: at.toISOString() }).where("flow_id", "=", flow));
    },
  };
  return api;
}

/** The time a schedule had due by `at`, counted from `since`; undefined when none is due yet. */
export function dueFlowTick(cron: string, since: Date, at: Date, timeZone: string | undefined): Date | undefined {
  const due = nextCron(parseCron(cron), since, timeZone);
  return due && due.getTime() <= at.getTime() ? due : undefined;
}

/** When a schedule fires next after `at`. */
export function nextFlowTick(cron: string, at: Date, timeZone: string | undefined): Date | undefined {
  try {
    return nextCron(parseCron(cron), at, timeZone);
  } catch {
    return undefined;
  }
}
