// Background work (delegations, wake-ups, routines; terminals later): what jobs.list reports, refreshed as runs move.
import type { Job } from "@apx/protocol";
import { client } from "./client.ts";
import { data } from "./state.ts";

let inflight = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** A user's own chat turn is not background; everything else that runs on its own is. */
export const isBackground = (j: Job) => j.kind === "terminal" || j.trigger !== "user" || j.parent_thread_id != null;

export async function loadJobs(): Promise<void> {
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  try {
    const r = await client.call("jobs.list", { finished: 12 });
    data.set({ jobs: r });
  } catch {
    // An older core without jobs.list: the Background tab stays empty.
  } finally {
    inflight = false;
    if (again) {
      again = false;
      void loadJobs();
    }
  }
}

/** run.updated fires per tool call; one refetch per burst is enough. */
export function jobsChanged(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void loadJobs();
  }, 400);
}
