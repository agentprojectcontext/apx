// Routines: work an agent does on a schedule. The row says what and when; each run is a normal run (its state lives
// in runs) in a conversation of its own, listed in routine_runs.
import type { CallModel, Routine, RoutineAction, RoutineRun, RunState, Schedule } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { RoutinesTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const toRoutine = (r: Selectable<RoutinesTable>, last: RoutineRun | undefined): Routine => ({
  id: r.id,
  name: r.name,
  ...opt("project_id", r.project_id),
  agent_id: r.agent_id,
  schedule: JSON.parse(r.schedule) as Schedule,
  action: r.action as RoutineAction,
  prompt: r.prompt,
  ...opt("pre_command", r.pre_command),
  ...opt("post_command", r.post_command),
  call_model: r.call_model as CallModel,
  anchor: Boolean(r.anchor),
  enabled: Boolean(r.enabled),
  ...opt("next_run_at", r.next_run_at),
  ...opt("last_run_at", r.last_run_at),
  ...(last ? { last } : {}),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export type RoutineDraft = {
  name: string;
  agent_id: string;
  project_id?: string | undefined;
  schedule: Schedule;
  action: RoutineAction;
  prompt: string;
  pre_command?: string | undefined;
  post_command?: string | undefined;
  call_model: CallModel;
  anchor?: boolean | undefined;
  enabled: boolean;
  next_run_at: string | undefined;
};

const commands = (d: RoutineDraft) => ({
  action: d.action,
  pre_command: d.pre_command || null,
  post_command: d.post_command || null,
  call_model: d.call_model,
  anchor: d.anchor ? 1 : 0,
});

export function routinesRepo({ one, all, run }: Sql) {
  const runsQuery = qb
    .selectFrom("routine_runs as rr")
    .innerJoin("runs as r", "r.id", "rr.run_id")
    .select(["rr.run_id", "rr.thread_id", "rr.started_at", "rr.delivered", "rr.model_called", "r.state", "r.ended_at"]);
  type RunRow = {
    run_id: string;
    thread_id: string;
    started_at: string;
    delivered: number | null;
    model_called: number | null;
    state: string;
    ended_at: string | null;
  };
  const toRun = (r: RunRow): RoutineRun => ({
    run_id: r.run_id,
    thread_id: r.thread_id,
    state: r.state as RunState,
    started_at: r.started_at,
    ...opt("ended_at", r.ended_at),
    ...(r.delivered === null ? {} : { delivered: Boolean(r.delivered) }),
    ...(r.model_called === null ? {} : { model_called: Boolean(r.model_called) }),
  });
  const lastOf = (id: string) => {
    const r = one(runsQuery.where("rr.routine_id", "=", id).orderBy("rr.started_at", "desc").limit(1));
    return r ? toRun(r) : undefined;
  };

  const repo = {
    get(id: string): Routine | undefined {
      const r = one(qb.selectFrom("routines").selectAll().where("id", "=", id));
      return r ? toRoutine(r, lastOf(r.id)) : undefined;
    },
    /** By name; `project` narrows to one project (null = only the global ones). */
    list(project?: string | null): Routine[] {
      let q = qb.selectFrom("routines").selectAll();
      if (project === null) q = q.where("project_id", "is", null);
      else if (project) q = q.where("project_id", "=", project);
      return all(q.orderBy("name")).map((r) => toRoutine(r, lastOf(r.id)));
    },
    create(d: RoutineDraft): Routine {
      const id = newId("rtn");
      const at = now();
      run(
        qb.insertInto("routines").values({
          id,
          name: d.name,
          project_id: d.project_id ?? null,
          agent_id: d.agent_id,
          schedule: JSON.stringify(d.schedule),
          prompt: d.prompt,
          ...commands(d),
          enabled: d.enabled ? 1 : 0,
          next_run_at: d.next_run_at ?? null,
          created_at: at,
          updated_at: at,
        }),
      );
      return repo.get(id) as Routine;
    },
    update(id: string, d: RoutineDraft): Routine | undefined {
      const changed = run(
        qb
          .updateTable("routines")
          .set({
            name: d.name,
            project_id: d.project_id ?? null,
            agent_id: d.agent_id,
            schedule: JSON.stringify(d.schedule),
            prompt: d.prompt,
            ...commands(d),
            enabled: d.enabled ? 1 : 0,
            next_run_at: d.next_run_at ?? null,
            updated_at: now(),
          })
          .where("id", "=", id),
      );
      return changed ? repo.get(id) : undefined;
    },
    remove(id: string): boolean {
      return run(qb.deleteFrom("routines").where("id", "=", id)) > 0;
    },
    /** Enabled routines whose time has come and that are not running already. */
    due(at: string): Routine[] {
      return all(
        qb
          .selectFrom("routines")
          .selectAll()
          .where("enabled", "=", 1)
          .where("next_run_at", "<=", at)
          .where((eb) => eb.or([eb("lease_until", "is", null), eb("lease_until", "<", at)])),
      ).map((r) => toRoutine(r, undefined));
    },
    /** Reserves a run: the next time is set and the routine is held until `lease_until`, before anything runs. */
    claim(id: string, o: { next_run_at: string | undefined; lease_until: string; at: string }): void {
      run(
        qb
          .updateTable("routines")
          .set({ next_run_at: o.next_run_at ?? null, lease_until: o.lease_until, last_run_at: o.at })
          .where("id", "=", id),
      );
    },
    release(id: string): void {
      run(qb.updateTable("routines").set({ lease_until: null }).where("id", "=", id));
    },
    addRun(r: { routine_id: string; run_id: string; thread_id: string }): void {
      run(qb.insertInto("routine_runs").values({ ...r, started_at: now() }));
    },
    /** The routine a run belongs to, if it is a routine's run. */
    ofRun(runId: string): string | undefined {
      return one(qb.selectFrom("routine_runs").select("routine_id").where("run_id", "=", runId))?.routine_id;
    },
    delivered(runId: string, told: boolean): void {
      run(
        qb
          .updateTable("routine_runs")
          .set({ delivered: told ? 1 : 0 })
          .where("run_id", "=", runId),
      );
    },
    /** Whether a run called its model (false: its pre-command said not to). */
    modelCalled(runId: string, called: boolean): void {
      run(
        qb
          .updateTable("routine_runs")
          .set({ model_called: called ? 1 : 0 })
          .where("run_id", "=", runId),
      );
    },
    runs(id: string, limit: number): RoutineRun[] {
      return all(runsQuery.where("rr.routine_id", "=", id).orderBy("rr.started_at", "desc").limit(limit)).map(toRun);
    },
  };
  return repo;
}
