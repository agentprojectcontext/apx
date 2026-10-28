import {
  type DelegationState,
  delegationState,
  latestDelegatedRun,
} from "../../../../packages/protocol/src/delegation.ts";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";

export type { DelegationState };

/** Where a delegated session stands now, read as the web reads it: its notice's buttons follow it. */
export async function sessionState(client: ApxClient, session: string): Promise<DelegationState> {
  const { thread, runs } = await client.call("threads.get", { thread: session });
  if (thread.archived) return "completed";
  return delegationState(thread, latestDelegatedRun(runs, session));
}

/** One more turn for a delegated session a limit stopped, as Continue on the web: the core checks it is still stopped. */
export async function continueSession(client: ApxClient, session: string): Promise<void> {
  const { runs } = await client.call("threads.get", { thread: session });
  const latest = latestDelegatedRun(runs, session);
  if (!latest) throw new Error(t("delegationGone"));
  await client.call("threads.send", {
    thread: session,
    text: t("delegationContinuePrompt"),
    mode: "queue",
    continue_run: latest.id,
  });
}
