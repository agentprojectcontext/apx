// Routines, for the owner only: an agent's scheduled work and its history.
import { checkSchedule } from "../domain/schedule.ts";
import type { Store } from "../domain/store.ts";
import type { Scheduler } from "../engine/routines.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function routineHandlers(store: Store, scheduler: Scheduler) {
  return {
    "routines.list": ({ project }) => ({ routines: store.routines.list(project) }),
    "routines.set": ({
      id,
      name,
      agent,
      project,
      schedule,
      prompt,
      pre_command,
      post_command,
      call_model,
      enabled,
    }) => {
      try {
        checkSchedule(schedule);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      const a = store.agents.get(agent);
      if (!a) throw notFound(`agent ${agent}`);
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      if (a.project_id && a.project_id !== project)
        throw badRequest(`${a.name} belongs to another project; pick one of this project's agents or a global one`);
      const next = enabled ? scheduler.nextFor(schedule) : undefined;
      if (enabled && schedule.kind === "once" && !next) throw badRequest("that moment has passed");
      const draft = {
        name,
        agent_id: agent,
        project_id: project,
        schedule,
        prompt,
        pre_command,
        post_command,
        call_model,
        enabled,
        next_run_at: next,
      };
      if (!id) return store.routines.create(draft);
      const r = store.routines.update(id, draft);
      if (!r) throw notFound(`routine ${id}`);
      return r;
    },
    "routines.remove": ({ routine }) => ({ removed: store.routines.remove(routine) }),
    "routines.run": ({ routine }) => scheduler.runNow(routine),
    "routines.runs": ({ routine, limit }) => {
      if (!store.routines.get(routine)) throw notFound(`routine ${routine}`);
      return { runs: store.routines.runs(routine, limit) };
    },
  } satisfies Partial<Handlers>;
}
