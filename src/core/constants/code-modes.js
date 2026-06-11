// Code session modes. PLAN = read-only exploration (the agent proposes
// changes but never mutates); BUILD = unrestricted execution. The value
// lives in code-sessions.json (session.mode) and is what api/code.js,
// stores/code-sessions.js, and agent/prompts/modes/ all branch on.
export const CODE_MODES = Object.freeze({
  PLAN: "plan",
  BUILD: "build",
});

export const DEFAULT_CODE_MODE = CODE_MODES.BUILD;
