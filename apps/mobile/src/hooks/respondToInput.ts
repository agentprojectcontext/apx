import { t } from "../i18n";
import { type Answer, type ApxClient, ApxError } from "../protocol";

/** A missed settlement event must not leave an unavailable request actionable. */
export async function respondToInput(
  client: ApxClient,
  input: string,
  answer: Answer,
  refresh: (unavailableInput?: string) => Promise<void>,
): Promise<void> {
  try {
    await client.call("runs.respond", { input, ...answer });
  } catch (error) {
    if (
      error instanceof ApxError &&
      error.code === "conflict" &&
      error.detail &&
      typeof error.detail === "object" &&
      "reason" in error.detail &&
      error.detail.reason === "input_unavailable"
    ) {
      await refresh(input);
      throw new Error(t("inputUnavailable"));
    }
    throw error;
  }
  await refresh();
}
