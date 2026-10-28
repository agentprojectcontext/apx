// Routines, for the owner only: an agent's scheduled work and its history.

import type { FlowStepKey } from "../domain/flow-graph-runs.ts";
import { checkSchedule } from "../domain/schedule.ts";
import type { Store } from "../domain/store.ts";
import {
  activeProfile,
  applyProfile,
  changedRoutines,
  fill,
  installProfile,
  listProfiles,
  type ProfileRoot,
  profileRoutines,
  profileSchedules,
  removeProfile,
  restoreProfileRoutine,
  scheduleOf,
  textIn,
  valuesFor,
} from "../engine/profiles.ts";
import type { Scheduler } from "../engine/routines.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

const PROFILE_HINT = "it needs an apx-profile.json";

export function routineHandlers(store: Store, scheduler: Scheduler, profileRoots: readonly ProfileRoot[] = []) {
  const lang = () => store.settings.get("owner_language") ?? "es";
  /** The running profile's routines, and which of them Restore would change. */
  const kept = (id: string | null) => {
    const routines = id ? profileRoutines(store, id) : [];
    return { routines, changed: changedRoutines(store, profileRoots, routines) };
  };
  const listed = () => {
    const active = activeProfile(store);
    return { profiles: listProfiles(profileRoots), active, ...kept(active.id) };
  };
  return {
    "routines.list": ({ project }) => ({ routines: store.routines.list(project) }),
    "secretary.set": ({ action, id, enabled, prompt }) =>
      store.tx(() => {
        const agent = store.agents.list().find((a) => a.kind === "secretary");
        if (!agent) throw notFound("super-agent");
        const existing = id
          ? store.routines.get(id)
          : store.routines.list(null).find((r) => r.action === action && r.agent_id === agent.id);
        if (id && (!existing || existing.action !== action))
          throw badRequest("capability changed; refresh its settings");
        if (existing)
          return store.routines.update(existing.id, {
            ...existing,
            enabled,
            prompt: prompt ?? existing.prompt,
            next_run_at:
              enabled === existing.enabled
                ? existing.next_run_at
                : enabled
                  ? scheduler.nextFor(existing.schedule)
                  : undefined,
          }) as NonNullable<typeof existing>;
        const active = activeProfile(store);
        const profiles = listProfiles(profileRoots);
        const manifest =
          profiles.find((p) => p.id === active.id && p.routines.some((r) => r.action === action)) ??
          profiles.find((p) => p.id === "secretary");
        const spec = manifest?.routines.find((r) => r.action === action);
        if (!manifest || !spec) throw notFound("capability defaults");
        const values = valuesFor(manifest, active.values);
        const schedule = scheduleOf(spec, manifest, values);
        checkSchedule(schedule);
        return store.routines.create({
          name: textIn(spec.name, lang()),
          agent_id: agent.id,
          action,
          prompt: prompt ?? fill(spec.prompt, manifest, values),
          schedule,
          enabled,
          next_run_at: enabled ? scheduler.nextFor(schedule) : undefined,
          call_model: "always",
          anchor: spec.anchor,
          origin: `${manifest.id}:${spec.key}`,
        });
      }),
    "routines.set": ({
      id,
      name,
      agent,
      project,
      schedule,
      action,
      prompt,
      pre_command,
      post_command,
      call_model,
      anchor,
      max_steps,
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
      const was = id ? store.routines.get(id) : undefined;
      const act = action ?? was?.action ?? "agent";
      if (act === "shell" && !(pre_command ?? was?.pre_command)) throw badRequest("a shell routine needs its command");
      const draft = {
        name,
        agent_id: agent,
        project_id: project,
        schedule,
        action: act,
        prompt,
        pre_command: pre_command ?? was?.pre_command,
        post_command: post_command ?? was?.post_command,
        call_model: call_model ?? was?.call_model ?? "always",
        anchor: anchor ?? was?.anchor ?? false,
        max_steps: max_steps === null ? undefined : (max_steps ?? was?.max_steps),
        origin: was?.origin,
        enabled,
        next_run_at: next,
      };
      if (!id) return store.routines.create(draft);
      const r = store.routines.update(id, draft);
      if (!r) throw notFound(`routine ${id}`);
      return r;
    },
    "routines.remove": ({ routine }) => ({ removed: store.routines.remove(routine) }),
    "profiles.list": () => listed(),
    "profiles.set": ({ id, values }) => {
      const manifest = id ? listProfiles(profileRoots).find((p) => p.id === id) : undefined;
      if (id && !manifest) throw notFound(`profile ${id}`);
      try {
        for (const s of manifest ? profileSchedules(manifest, values) : []) checkSchedule(s);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      const active = applyProfile(store, { manifest, values, lang: lang(), nextFor: (s) => scheduler.nextFor(s) });
      return { active, ...kept(active.id) };
    },
    "profiles.restore": ({ routine }) => {
      const r = restoreProfileRoutine(store, profileRoots, routine);
      if (!r) throw notFound(`profile routine ${routine}`);
      return r;
    },
    "profiles.install": ({ path }) => {
      try {
        return { profile: installProfile(profileRoots, path) };
      } catch (err) {
        throw badRequest(`not a profile folder (${PROFILE_HINT}): ${errorMessage(err, 200)}`);
      }
    },
    "profiles.remove": ({ id }) => {
      const removed = removeProfile(profileRoots, id);
      if (removed && activeProfile(store).id === id)
        applyProfile(store, { manifest: undefined, values: {}, lang: lang(), nextFor: (s) => scheduler.nextFor(s) });
      return { removed };
    },
    "routines.run": ({ routine }, ctx) =>
      store.tx(() => {
        if (ctx.flowEvent?.graph)
          return runGraphStep(store, scheduler, routine, { ...ctx.flowEvent, ...ctx.flowEvent.graph });
        const source = ctx.flowEvent ? store.flows.admissionInput(ctx.flowEvent.flow, ctx.flowEvent.event) : undefined;
        if (source) {
          const binding = store.routines.get(routine);
          const flow = store.flows.get(source.flow);
          if (
            source.action.kind !== "routine" ||
            source.action.routine !== routine ||
            !flow?.enabled ||
            binding?.project_id !== flow.projectId ||
            binding?.schedule.kind !== "manual"
          )
            throw badRequest("Flow routine binding changed");
        }
        const run = scheduler.runNow(
          routine,
          source ? { flow: source.flow, id: source.id, data: source.data } : undefined,
        );
        if (ctx.flowEvent) store.flows.admitted(ctx.flowEvent.flow, ctx.flowEvent.event, run.run_id);
        return run;
      }),
    "routines.runs": ({ routine, limit }) => {
      if (!store.routines.get(routine)) throw notFound(`routine ${routine}`);
      return { runs: store.routines.runs(routine, limit) };
    },
  } satisfies Partial<Handlers>;
}

/**
 * A graph step starts its routine: the routine must be the one its pinned revision names, manual-only and in the
 * Flow's project; the run gets the step's input as the untrusted event data and is linked to the step at once.
 */
function runGraphStep(store: Store, scheduler: Scheduler, routine: string, step: FlowStepKey) {
  const run = store.flowGraphRuns.load(step.flow, step.event);
  const node = run?.revision === step.revision ? run.graph.nodes.find((n) => n.id === step.node) : undefined;
  const binding = store.routines.get(routine);
  const flow = store.flows.get(step.flow);
  if (
    node?.kind !== "routine" ||
    node.routine !== routine ||
    !flow?.enabled ||
    binding?.project_id !== flow.projectId ||
    binding.schedule.kind !== "manual"
  )
    throw badRequest("Flow routine binding changed");
  const data = store.flowGraphRuns.startingInput(step);
  const started = scheduler.runNow(routine, { flow: step.flow, id: step.event, data });
  store.flowGraphRuns.linkRun(step, started.run_id);
  return started;
}
