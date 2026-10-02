// Routines (routines.*): read when their screen opens and after every change; runs show up as normal runs.
import type { CallModel, Routine, RoutineAction, RoutineRun, Schedule } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { routines: Routine[]; ready: boolean };
const store = createStore<State>({ routines: [], ready: false });

export const useRoutines = <T>(select: (s: State) => T): T => useSlice(store, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (e: unknown) => notify(t("error.routines", { error: errText(e) }));

export async function loadRoutines(): Promise<void> {
  try {
    store.set({ routines: (await client.call("routines.list", {})).routines, ready: true });
  } catch (e) {
    store.set({ ready: true });
    fail(e);
  }
}

let reload: ReturnType<typeof setTimeout> | undefined;
/** A routine's run started or ended: read the routines again (once the core has recorded how it went). */
export function routineRunChanged(): void {
  if (!store.get().ready) return;
  clearTimeout(reload);
  reload = setTimeout(() => void loadRoutines(), 400);
}

export type RoutineDraft = {
  id?: string | undefined;
  name: string;
  agent: string;
  project?: string | undefined;
  schedule: Schedule;
  action: RoutineAction;
  prompt: string;
  /** Shell before the agent (its output reaches the prompt) and after it; empty = none. */
  pre_command: string;
  post_command: string;
  call_model: CallModel;
  enabled: boolean;
};

/** Saves a routine; false (and a notice) when the core refused it. */
export async function saveRoutine(d: RoutineDraft): Promise<boolean> {
  try {
    await client.call("routines.set", {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      agent: d.agent,
      ...(d.project ? { project: d.project } : {}),
      schedule: d.schedule,
      action: d.action,
      prompt: d.prompt,
      pre_command: d.pre_command.trim(),
      post_command: d.post_command.trim(),
      call_model: d.call_model,
      enabled: d.enabled,
    });
    await loadRoutines();
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

export const draftOf = (r: Routine): RoutineDraft => ({
  id: r.id,
  name: r.name,
  agent: r.agent_id,
  project: r.project_id,
  schedule: r.schedule,
  action: r.action,
  prompt: r.prompt,
  pre_command: r.pre_command ?? "",
  post_command: r.post_command ?? "",
  call_model: r.call_model,
  enabled: r.enabled,
});

export async function removeRoutine(id: string): Promise<void> {
  try {
    await client.call("routines.remove", { routine: id });
    await loadRoutines();
  } catch (e) {
    fail(e);
  }
}

export async function runRoutine(id: string): Promise<RoutineRun | undefined> {
  try {
    const run = await client.call("routines.run", { routine: id });
    await loadRoutines();
    return run;
  } catch (e) {
    fail(e);
    return undefined;
  }
}

export async function routineRuns(id: string): Promise<RoutineRun[]> {
  try {
    return (await client.call("routines.runs", { routine: id })).runs;
  } catch (e) {
    fail(e);
    return [];
  }
}
