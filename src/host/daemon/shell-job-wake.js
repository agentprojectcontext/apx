// Bringing an agent back when the command it left running ends.
//
// The a2a half of this is an a2a message in reverse: the peer that did the work
// writes back, and `messagePeer` already knows how to start a turn for that.
// A shell job has no peer to write as. Inventing one — a sender called "shell" —
// would put a face in the inbox for something that is not an agent, and would
// wake the agent under a2a etiquette ("you are talking to a peer; do not tell
// the owner anything, relay it") which is exactly wrong for a render the OWNER
// asked for, in the chat the owner is reading.
//
// So the wake-up goes back where the work came from: the agent's own chat, the
// conversation it was in when it launched the job (`job.origin`), as an ordinary
// turn. It reads its own history, has its own tools, and can answer the person
// sitting there — because that is who is waiting.
//
// WHY A BUS LISTENER AND NOT A CALL. Three different things end a job: the
// process exits (core/agent/shell/background.js), the owner cancels it
// (api/jobs.js → cancelJob), or the reconciler harvests it after a restart. All
// three already announce the ending as a `background_job` end event — the panel
// is drawn from it. Listening to that means one path for all three instead of
// three call sites that must each remember to wake somebody, and it keeps the
// turn machinery out of core, which may not reach into the daemon (rule 8).
//
// Exactly-once is `claimWake`'s, not this module's: an atomic `open(…, "wx")`
// that returns true for one caller ever. See its header for why waking twice is
// the failure worth spending a syscall on.
import { onBackgroundJobEvent } from "#core/events/bus.js";
import { claimWake, jobKind, JOB_KINDS } from "#core/stores/background-jobs.js";
import { shellWakeText } from "#core/agent/shell/background.js";
import { readAgents } from "#core/apc/parser.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { CHANNELS } from "#core/constants/channels.js";
import { runChatTurn } from "./agent-chat-turn.js";
import { getActiveTurnByKey, convTurnKey } from "./active-turns.js";

/** How often we look again to see whether the chat is free. */
const BUSY_POLL_MS = 2000;

/** How long a wake-up waits for a busy chat before going in anyway. A turn that
 *  has run for a quarter of an hour is not about to end, and a result nobody is
 *  ever told about is worse than two turns in one thread. */
const BUSY_MAX_MS = 15 * 60 * 1000;

/**
 * One wake-up at a time per agent, in the order the jobs ended.
 *
 * Three reels finishing within the same second is the normal case, not the edge
 * one — the fan-out wall is three. Without this they would start three turns in
 * the same conversation at once: three replies interleaved into one file, three
 * bills, and an agent arguing with itself about what is done.
 */
const queues = new Map();

function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(task, task);
  queues.set(key, next);
  // Let the map forget a queue that has drained, so it does not grow one entry
  // per agent that ever ran a job.
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/** Wait for whatever is already talking in this chat to finish. */
async function waitForQuietChat(projectId, conversationId, log) {
  if (!conversationId) return;
  const key = convTurnKey(projectId, conversationId);
  const until = Date.now() + BUSY_MAX_MS;
  let waited = false;
  while (getActiveTurnByKey(key) && Date.now() < until) {
    waited = true;
    await sleep(BUSY_POLL_MS);
  }
  if (waited) log?.(`shell-job-wake: waited for ${conversationId} to be free`);
}

/**
 * Wake the agent that left this job running. Never throws — it is called from an
 * event listener, and an unhandled rejection here would take the daemon with it.
 */
export async function wakeShellJob(job, {
  projects, config, plugins, registries, log,
  // Injected the way `replyAsAgent` takes `runAgentTurnFn`: this function's job
  // is deciding WHO is woken, WHERE, and exactly once — all three worth
  // asserting without standing up an engine to answer the wake-up.
  runChatTurnFn = runChatTurn,
  // How long to wait before the second attempt. Injectable for the same reason
  // runChatTurnFn is: the retry is behaviour worth asserting, and a test that
  // asserts it should not pay two real seconds for the privilege — nor await an
  // UNREF'd timer with nothing else pending, which is how this test began
  // failing in CI while passing on every developer machine ("Promise resolution
  // is still pending but the event loop has already resolved").
  retryDelayMs = 2000,
} = {}) {
  const project = projects?.get?.(job.project_id);
  if (!project) {
    log?.(`shell-job-wake: cannot wake ${job.from} for ${job.id} — project ${job.project_id} is gone`);
    return { woken: false, reason: "project gone" };
  }

  let agent = null;
  try {
    agent = readAgents(project.path).find((a) => a.slug === job.from) || null;
  } catch { /* an unreadable roster is the same as a missing agent */ }
  if (!agent) {
    log?.(`shell-job-wake: cannot wake ${job.from} for ${job.id} — no such agent in ${project.id}`);
    return { woken: false, reason: "agent gone" };
  }

  const modelId = await resolveAgentModel({ agent, config: project.config || config, autonomous: true });
  if (!modelId) {
    log?.(`shell-job-wake: cannot wake ${job.from} for ${job.id} — the agent has no model`);
    return { woken: false, reason: "no model" };
  }

  await waitForQuietChat(project.id, job.origin?.conversation_id, log);

  // Claimed as late as possible, and always before the turn. Late, because a
  // claim taken and then lost to a crash is a wake-up nobody will ever deliver
  // again; before, because a turn that runs and then fails to claim has already
  // spent the tokens and done the work twice.
  if (!claimWake(job.id)) return { woken: false, reason: "already delivered" };

  // TWO ATTEMPTS, because the claim is already spent. Nothing re-delivers a
  // wake-up: the reconciler only sweeps jobs that are still open, so a turn that
  // throws is the end of it — which is exactly what happened on 2026-09-14, when
  // an engine 400 ate both wake-ups of the evening and the agent answered
  // nothing twice. The turn is retried once before that verdict is accepted.
  //
  // What is NOT lost either way: the wake-up text is already filed in the
  // conversation, so the next turn anybody starts in that chat reads it as
  // history. The agent loses the chance to act on its own, not the information.
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const out = await runChatTurnFn({
      p: project,
      agent,
      modelId,
      conversationId: job.origin?.conversation_id || null,
      channel: job.origin?.channel || CHANNELS.API,
      prompt: shellWakeText(job),
      // Nobody typed this. Recorded on the turn so the thread's own history says
      // where it came from, rather than reading as the owner having pasted an
      // exit code into their chat at four in the morning.
      //
      // The outcome rides as FIELDS, not only inside the prose: the panel draws
      // a line from them, and parsing "it exited 127" back out of a paragraph
      // written for a model is the kind of thing that works until the paragraph
      // is reworded.
      promptMeta: {
        automation: "background_job",
        job: {
          id: job.id,
          status: job.status,
          exit_code: job.exit_code ?? null,
          command: String(job.command || "").slice(0, 300),
        },
      },
      config: project.config || config,
      projects,
      plugins,
      registries,
    });
    log?.(`shell-job-wake: woke ${job.from} for ${job.id} in ${out.conversation_id}`);
    return { woken: true, conversation_id: out.conversation_id };
  } catch (e) {
    lastError = e;
    if (attempt === 1) {
      log?.(`shell-job-wake: wake for ${job.id} failed (${e?.message || e}) — retrying once`);
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      continue;
    }
    // The record still holds the outcome and the panel still shows it ended, so
    // what is lost is the nudge, not the result. Said out loud rather than
    // swallowed — an agent that was promised a wake-up and did not get one is
    // the failure this whole feature exists to remove.
    log?.(`shell-job-wake: wake for ${job.id} failed — ${e?.message || e}`);
  }
  }
  return { woken: false, reason: lastError?.message || String(lastError) };
}

/**
 * Start listening. Returns `{ stop }`, like the reconcilers.
 */
export function startShellJobWake({ projects, config, plugins, registries, log, runChatTurnFn } = {}) {
  const unsubscribe = onBackgroundJobEvent((event) => {
    if (event?.phase !== "end") return;
    const job = event.job;
    if (!job || jobKind(job) !== JOB_KINDS.SHELL || !job.wake) return;
    // Serialised per agent rather than per conversation: an agent woken in two
    // chats at once is still one agent taking two turns, and the second one
    // would read a memory the first is in the middle of writing.
    enqueue(`${job.project_id}:${job.from}`, () =>
      wakeShellJob(job, { projects, config, plugins, registries, log, runChatTurnFn }));
  });
  return { stop: unsubscribe };
}
