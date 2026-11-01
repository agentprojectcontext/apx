// Restarting into a newer APX quits this app, so this page never hears back when it works: an answer, or still being
// here after a while, means it did not, and the owner gets a way out instead of a spinner.
export type RestartAnswer = { ok: true } | { ok: false; error: string } | undefined;
export type RestartOutcome = { phase: "failed"; log: string } | { phase: "stalled" };

/** Longer than the app takes to quit; an app older than this answer only stops waiting here. */
export const RESTART_WAIT_MS = 60_000;

export async function restartOutcome(
  restart: (() => Promise<RestartAnswer> | undefined) | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<RestartOutcome> {
  let answer: RestartAnswer;
  try {
    answer = (await restart?.()) ?? undefined;
  } catch (e) {
    return { phase: "failed", log: e instanceof Error ? e.message : String(e) };
  }
  if (answer && !answer.ok) return { phase: "failed", log: answer.error };
  await wait(RESTART_WAIT_MS);
  return { phase: "stalled" };
}
