// The super-agent handing a piece of work to a project agent.
//
// It used to be a single `callEngineWithFallback` behind the `call_agent` tool:
// one model call, NO tool loop, logged to a channel called "engine" that is not
// in CHANNELS and that no surface lists. Three consequences, and the third is
// the one that cost a day.
//
//   1. The agent could not DO anything. Asked to read a repo and open a task,
//      it answered "I'm on it. Let me start by pulling the recent repo
//      activity" followed by `<tool_call><function=git_log>…` as literal text —
//      a model with no tools describing the tools it did not have. That text
//      came back as the tool's result.
//   2. Nothing was visible. No thread, nowhere to look, no way to tell whether
//      the work had happened.
//   3. So the answer READ like work. The owner saw a confident reply in the
//      transcript and had no way to learn that the repo was never opened and
//      the task was never created.
//
// Delegation is a conversation between two agents, which is exactly what the
// a2a path already is: `replyAsAgent` runs the real tool loop through
// `runAgentTurn`, and the exchange lands on CHANNELS.A2A — so it shows up in
// the inbox as a chat with both faces, carries its own history, and can be
// read and continued like any other.
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import { CHANNELS } from "#core/constants/channels.js";
import { a2aThreadId } from "#core/stores/messages.js";
import { shortId } from "#core/util/ids.js";
import { replyAsAgent } from "./reply.js";
import { a2aPairHistory } from "./history.js";

/**
 * Deliver `prompt` to `agent` as the super-agent, and file both halves.
 *
 * Returns what the agent said plus the `thread` it said it in, because the
 * caller's next sentence to the owner is always "and you can read it here".
 */
export async function delegateToAgent({
  project,
  agent,
  prompt,
  config,
  from = SUPERAGENT_ACTOR_ID,
  projects,
  plugins,
  registries,
  signal = null,
  historyLimit = 24,
  // Injected in tests, the way `replyAsAgent` takes `runAgentTurnFn` — this
  // function's job is the thread it files, and that is worth asserting without
  // standing up an engine.
  replyFn = replyAsAgent,
}) {
  const to = agent.slug;
  const thread = a2aThreadId(from, to);
  // Before the inbound row is written, or the instruction being delivered
  // arrives as something the agent already heard.
  const history = a2aPairHistory(project.storagePath, from, to, to, historyLimit);

  const ts = new Date().toISOString();
  const messageId = shortId("a2a");
  // Both halves of every utterance, the same shape `apx send --deliver` writes:
  // one row owned by the sender, one by the recipient. That pairing is what
  // makes `listProjectA2AThreads` see a conversation rather than two monologues.
  project.logMessage({
    agent_slug: to,
    channel: CHANNELS.A2A,
    direction: "in",
    author: from,
    body: prompt,
    meta: { from, via: "delegation" },
    ts,
    external_id: messageId,
  });

  const result = await replyFn({
    project,
    projectPath: project.path,
    toAgent: agent,
    fromAgent: { slug: from },
    body: prompt,
    config,
    history,
    selfAddress: to,
    peerAddress: from,
    projectId: project.id,
    projects,
    plugins,
    registries,
    // The whole point. A delegated agent that cannot run a tool can only
    // describe the work.
    tools: true,
    signal,
  });

  const replyTs = new Date().toISOString();
  const replyId = shortId("a2a");
  project.logMessage({
    agent_slug: to,
    channel: CHANNELS.A2A,
    direction: "out",
    type: "agent",
    actor_kind: "agent",
    actor_id: to,
    author: to,
    body: result.text,
    meta: {
      to: from,
      via: "delegation",
      final: true,
      model: result.model,
      usage: result.usage,
      trace: result.trace,
    },
    ts: replyTs,
    external_id: replyId,
  });
  project.logMessage({
    agent_slug: from,
    channel: CHANNELS.A2A,
    direction: "in",
    author: to,
    body: result.text,
    meta: { from: to, via: "delegation" },
    ts: replyTs,
    external_id: replyId,
  });

  return {
    text: result.text,
    usage: result.usage,
    model: result.model,
    media: result.media,
    // Where the conversation lives, so the caller can say so instead of the
    // owner having to go looking for it.
    thread,
    channel: CHANNELS.A2A,
  };
}
