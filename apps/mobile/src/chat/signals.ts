/** The whole answer is SKIP ("SKIP", "**skip**.", "`SKIP`"): the agent had nothing worth saying, as the core reads it. */
export const isSkipAnswer = (text: string): boolean => text.replace(/[.\s*_`~"'!]/g, "").toUpperCase() === "SKIP";
