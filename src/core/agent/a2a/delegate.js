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
import { replyAsAgent, replyToPeer } from "./reply.js";
import { resolvePeer, peerAddress, senderAddress } from "./peers.js";
import { readAgents } from "#core/apc/parser.js";
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
  // Forwarded, not required: a caller that registers an active turn for this
  // delegation can watch and stop it the way the a2a route does.
  onEvent = null,
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
    onEvent,
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


/**
 * One agent writing to another — whoever the other is.
 *
 * The generalisation of `delegateToAgent`, and the thing that was missing:
 * `call_agent` can only address a PROJECT agent, so an agent that wanted to
 * reach the super-agent had no tool at all. Ansel's answer to that was to shell
 * out — `run_shell` with `apx send orchestrator default "…" --deliver` — which
 * works, and blocks: the CLI waits for the reply, so Ansel sat frozen for the
 * ten minutes the super-agent took to answer, and from every surface the two of
 * them looked dead.
 *
 * `resolvePeer` is what makes this general: a project agent, the super-agent, or
 * a coding runtime all resolve from the same address, and `replyToPeer` runs
 * whichever it turns out to be.
 */
export async function messagePeer({
  project,
  to,
  body,
  from,
  config,
  projects,
  plugins,
  registries,
  signal = null,
  onEvent = null,
  historyLimit = 24,
  // How many hand-offs deep this exchange already is. Carried into the
  // recipient's turn (as `channelMeta.a2aDepth`) so that if IT hands work on
  // again, the chain is counted rather than restarting at zero on every hop.
  // Without it a hand-off is unbounded: A asks B, B asks A, forever, each hop a
  // full tool loop. `POST /projects/:pid/send` has walled its own `_depth`
  // since the route existed; the tool path had no equivalent.
  depth = 0,
  replyFn = replyToPeer,
}) {
  const agents = readAgents(project.path);
  const peer = resolvePeer(to, agents, config);
  if (!peer) throw new Error(`no peer named ${to}`);
  const address = peerAddress(peer);
  // BOTH ENDS, not just the recipient.
  //
  // `to` has always been canonicalised here and `from` never was, so a sender
  // named any way other than by its slug opened a thread of its own. A model may
  // legitimately say `Zoya` — the tool's own description offers the roster, and
  // `resolvePeer` accepts a display name precisely so it can — and the wake-up
  // for a background job writes back with `from = job.to`, which is whatever
  // string the model used. One exchange then lives in two threads: `ceo~cfo`
  // with two faces and a proper title, and `cfo~zoya` with a letter for an
  // avatar and a raw slug where a name should be, because nothing can resolve
  // `zoya` to an agent.
  //
  // `POST /projects/:pid/send` fixed this at the route (1975c64) and the TOOL
  // path was left behind. Same rule, one call: whatever spelling reaches us,
  // the thread is named by the pair of slugs.
  const sender = senderAddress(from, agents, config) || from;
  const thread = a2aThreadId(sender, address);
  const history = a2aPairHistory(project.storagePath, sender, address, address, historyLimit);

  const ts = new Date().toISOString();
  const messageId = shortId("a2a");
  project.logMessage({
    agent_slug: address,
    channel: CHANNELS.A2A,
    direction: "in",
    author: sender,
    body,
    meta: { from: sender, via: "tool" },
    ts,
    external_id: messageId,
  });

  const result = await replyFn({
    peer,
    project,
    projectPath: project.path,
    projectName: project.name || "",
    // The peer is answering the SENDER, so it has to be told who that is in the
    // same spelling the thread is filed under — otherwise its reply's etiquette
    // block addresses a name the ledger has never heard of.
    fromAgent: { slug: sender },
    fromAddress: sender,
    body,
    config,
    history,
    projectId: project.id,
    projects,
    plugins,
    registries,
    signal,
    onEvent,
    depth,
  });

  const replyTs = new Date().toISOString();
  const replyId = shortId("a2a");
  project.logMessage({
    agent_slug: address,
    channel: CHANNELS.A2A,
    direction: "out",
    type: "agent",
    actor_kind: "agent",
    actor_id: address,
    author: address,
    body: result.text,
    meta: {
      to: sender,
      via: "tool",
      final: true,
      model: result.model,
      usage: result.usage,
      trace: result.trace,
    },
    ts: replyTs,
    external_id: replyId,
  });
  project.logMessage({
    agent_slug: sender,
    channel: CHANNELS.A2A,
    direction: "in",
    author: address,
    body: result.text,
    meta: { from: address, via: "tool" },
    ts: replyTs,
    external_id: replyId,
  });

  return {
    text: result.text,
    usage: result.usage,
    model: result.model,
    thread,
    channel: CHANNELS.A2A,
  };
}
