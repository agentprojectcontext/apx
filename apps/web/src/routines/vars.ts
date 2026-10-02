// What each step of a routine can name, offered as the owner types "$" or "{{".
import type { Suggestion } from "@apx/ui";
import type { T } from "../i18n/index.ts";

/** In the prompt or the message: the pre-command's output. */
export const promptVars = (t: T): Suggestion[] => [{ insert: "{{pre_output}}", hint: t("routines.var.preOutput") }];

/** In the post-command: what the run produced and how it went. */
export const postVars = (t: T): Suggestion[] => [
  { insert: "$APX_LLM_OUTPUT", hint: t("routines.var.llmOutput") },
  { insert: "$APX_STATUS", hint: t("routines.var.status") },
  { insert: "$APX_SKIPPED", hint: t("routines.var.skipped") },
  { insert: "$APX_PRE_OUTPUT", hint: t("routines.var.preOutputEnv") },
  { insert: "$APX_PRE_EXIT", hint: t("routines.var.preExit") },
];
