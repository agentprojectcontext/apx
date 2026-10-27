import type { MessageKey } from "../i18n/messages.ts";

const runStates = {
  queued: "run.queued",
  submitted: "run.submitted",
  working: "run.working",
  "input-required": "run.waiting",
  completed: "run.done",
  failed: "run.failed",
  canceled: "run.canceled",
} as const satisfies Record<string, MessageKey>;

export function flowRunStateKey(state: string | null): MessageKey {
  return state !== null && Object.hasOwn(runStates, state)
    ? runStates[state as keyof typeof runStates]
    : "flow.unknownState";
}
