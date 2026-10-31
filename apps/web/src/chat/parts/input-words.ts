/** Tools whose card already says the change in the person's words: its folded line names that, never the tool. */
export const SAYS_ITSELF: ReadonlySet<string> = new Set(["apx_settings", "apx_flow"]);

/** The card's first sentence ("Prender «Leads»"), for the line it folds into once answered. */
export const cardLine = (detail: string) =>
  (detail.split("\n")[0] ?? "").split(/(?<=[^.]{3})\. |: /)[0]?.slice(0, 90) ?? "";
