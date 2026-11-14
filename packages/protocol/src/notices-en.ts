export const noticeEn = {
  "notice.run.stepLimit":
    "Ran out of steps for this turn: this is a report of what is done and left, not a final answer.",
  "notice.run.noModel": "No model available: none of the models could answer (out of quota, signed out or down).",
  "notice.run.noModel.limit": "Stopped by the model provider's usage limit, which lifts at {until}.",
  "notice.run.noModel.limitUnknown": "Stopped by the model provider's usage limit (it did not say when it lifts).",
  "notice.routine.shell": "Ran the command.",
  "notice.routine.watch.quiet": "Nothing new to watch: the model was not called.",
  "notice.routine.relay.quiet": "No team news to tell: the model was not called.",
  "notice.routine.pre.ok": "Pre-command: ok",
  "notice.routine.pre.failed": "Pre-command: failed (exit {exit})",
  "notice.routine.pre.timeout": "Pre-command: timed out",
  "notice.routine.post.ok": "Post-command: ok",
  "notice.routine.post.failed": "Post-command: failed (exit {exit})",
  "notice.routine.post.timeout": "Post-command: timed out",
  "notice.routine.skipped": "The model was not called; the pre-command's result did not ask for it.",
  "notice.breaker.paused.runs":
    "Paused: agents started {spent} turns on their own since you last wrote here. {who} finished; write to continue.",
  "notice.breaker.paused.tokens":
    "Paused: agents spent {spent} tokens on their own since you last wrote here. {who} finished; write to continue.",
  "notice.breaker.paused.link": "Change the limit",
  "notice.breaker.held.runs":
    "Paused: agents started {spent} turns on their own since you last wrote here. {who} starts “{task}” once you let them go on.",
  "notice.breaker.held.tokens":
    "Paused: agents spent {spent} tokens on their own since you last wrote here. {who} starts “{task}” once you let them go on.",
  "notice.breaker.held.agentRuns":
    "Paused for {who}: {who} started {spent} turns on its own since you last wrote here, its own limit. It starts “{task}” once you let them go on.",
  "notice.breaker.held.agentTokens":
    "Paused for {who}: {who} spent {spent} tokens on its own since you last wrote here, its own limit. It starts “{task}” once you let them go on.",
  "notice.breaker.held.link": "Change the limit",
  "notice.breaker.paused.progressRuns":
    "Paused: agents took {spent} turns on “{stuck}” without finishing a step of its plan. {who} finished; write to continue.",
  "notice.breaker.paused.progressTokens":
    "Paused: agents spent {spent} tokens on “{stuck}” without finishing a step of its plan. {who} finished; write to continue.",
  "notice.breaker.held.progressRuns":
    "Paused: agents took {spent} turns on “{stuck}” without finishing a step of its plan. {who} starts “{task}” once you let them go on.",
  "notice.breaker.held.progressTokens":
    "Paused: agents spent {spent} tokens on “{stuck}” without finishing a step of its plan. {who} starts “{task}” once you let them go on.",
  "notice.breaker.reset": "Restart the budget",
  "notice.breaker.release": "Let them finish this round",
  "notice.breaker.wentOn": "Agents went on",
  "notice.delegation.limit.continuedSteps":
    "{who} ran out of steps on “{task}” and is making progress; APX had it go on in session {session}. So far: {sofar}",
  "notice.delegation.limit.continuedTime":
    "{who} ran out of time on “{task}” and is making progress; APX had it go on in session {session}. So far: {sofar}",
  "notice.delegation.limit.stoppedSteps":
    "{who} ran out of steps on “{task}” and its last part made no progress, so APX did not go on by itself. Continue if it should. So far: {sofar}",
  "notice.delegation.limit.stoppedTime":
    "{who} ran out of time on “{task}” and its last part made no progress, so APX did not go on by itself. Continue if it should. So far: {sofar}",
  "notice.delegation.limit.returnedSteps":
    "{who} ran out of steps on “{task}”. {caller} has its report and decides how to go on. So far: {sofar}",
  "notice.delegation.limit.returnedTime":
    "{who} ran out of time on “{task}”. {caller} has its report and decides how to go on. So far: {sofar}",
  "notice.delegation.limit.open": "Open session",
  "notice.delegation.limit.loading": "Checking session…",
  "notice.delegation.limit.working": "Still working",
  "notice.delegation.limit.queued": "Queued",
  "notice.delegation.limit.waiting": "Waiting for your answer",
  "notice.delegation.limit.completed": "Finished",
  "notice.delegation.limit.continue": "Continue",
  "notice.delegation.limit.continuing": "Continuing…",
  "notice.delegation.limit.offline": "Offline: current session status unavailable",
  "notice.delegation.limit.unavailable": "Could not check session status",
  "notice.delegation.limit.continuePrompt":
    "Continue the remaining work in this session from the last progress report. Keep the existing scope and permissions; report the result to the original caller.",
  "notice.delegation.limit.stop": "Stop it",
  "notice.delegation.limit.stopped": "Stopped",
  "notice.delegation.limit.ended": "It had already ended",
  "notice.delegation.continued": "APX continued this session after a limit stopped it.",
  "notice.run.interrupted": "Interrupted by a restart of APX.",
  "notice.run.resumed": "Interrupted by a restart of APX; picking it back up.",
  "notice.run.canceled": "Canceled.",
  "notice.run.failed": "Could not finish.",
  "notice.run.failed.network": "Could not reach the model provider: no connection.",
  "notice.run.failed.timeout": "It took too long and was stopped.",
  "notice.run.failed.limit": "The model provider's usage limit was reached.",
  "notice.run.failed.signed_out": "The model provider asks to sign in again.",
  "notice.run.failed.refused": "The model provider refused the request.",
  "notice.run.failed.down": "The model provider is down or overloaded.",
  "notice.run.failed.restart": "APX restarted while it was running.",
  "notice.run.empty": "Finished without a message.",
  "notice.harness.fallback": "The chosen engine was not available; answered with the built-in model.",
  "notice.info": "Note",
  "notice.warn": "Warning",
  "notice.engine.fallback": "{model} did not answer ({why}); went on with {to}.",
  "notice.engine.fallback.title": "Switched model",
  "notice.thread.compacted":
    "Earlier turns were summarized to keep this chat's context small. Nothing new was started.",
  "notice.task.stalled": "Nothing was running on this task: APX asked the agent to go on or say what it waits for.",
  "notice.pairing.request": "Someone new wants to talk on a channel: approve them in Channels.",
};

export type NoticeKey = keyof typeof noticeEn;
