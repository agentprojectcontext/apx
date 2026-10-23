import { t } from "../i18n";
import type { ApxClient } from "../protocol";

/** One more turn for a delegated session a limit stopped, as Continue on the web: the core checks it is still stopped. */
export async function continueSession(client: ApxClient, session: string): Promise<void> {
  const { runs } = await client.call("threads.get", { thread: session });
  const latest = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  if (!latest) throw new Error(t("delegationGone"));
  await client.call("threads.send", {
    thread: session,
    text: t("delegationContinuePrompt"),
    mode: "queue",
    continue_run: latest.id,
  });
}
