// Picking up, after a restart, the turns the last daemon had to cut off.
//
// This is the far half of the drain. `apx restart` waits ten seconds for the
// work in flight (active-turns.js drainActiveTurns); what cannot finish in that
// window is cut off, and written down on the way out
// (core/stores/resumable-turns.js). This module is what reads that back once
// the new daemon is up, and finishes the job.
//
// Three things make it safe enough to do automatically:
//
//  1. **Only turns that DID something.** A turn that started three seconds ago
//     and produced nothing is dropped: relaunching it buys exactly what
//     re-sending the message by hand would buy, with all the risk of a resume.
//     (isWorthResuming.)
//  2. **The side-effect ledger starts seeded.** Every tool the first life
//     completed is already spent, so a repeat is answered "already done"
//     instead of running — mechanically, not by asking the model nicely.
//     (priorEffects → agent/loop/side-effects.js.)
//  3. **One attempt.** The store is emptied before anything runs, so a record
//     that makes the resume throw cannot come back at the next boot and turn
//     one bad turn into a daemon that will not start. (claimResumableTurns.)
//
// What it deliberately does NOT do is reopen the client's stream. That socket
// died with the old process. The resumed turn writes to the conversation and
// the ledger like any other turn, and every open panel finds out over the live
// feed — the same path a routine's turn takes.
import { claimResumableTurns } from "#core/stores/resumable-turns.js";
import { buildResumeHeader, prependResumeHeader } from "#core/agent/resume-header.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { runAgentTurn } from "#core/agent/run-turn.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { readConversation } from "#core/stores/conversations.js";
import { recordAgentTurn } from "#core/stores/turn-record.js";
import { CHANNELS } from "#core/constants/channels.js";

/**
 * Wait before resuming.
 *
 * The daemon has just come up and is still settling — plugins connecting, MCP
 * registries spawning, the skills index refreshing. A resumed turn is a full
 * tool loop and wants those ready. It is also, from the owner's point of view,
 * a message arriving on its own; letting the restart visibly finish first keeps
 * it from racing the panel that is still reconnecting.
 */
const START_DELAY_MS = 5_000;

/** One at a time. Two long resumed turns firing together on a just-booted
 *  daemon is a thundering herd against the same model and the same stores, for
 *  work whose whole point is that nobody is waiting on it this second. */
async function resumeEach(records, run, log) {
  for (const rec of records) {
    try {
      await run(rec);
    } catch (e) {
      // A resume that fails is not worth a crash: the partial is already in the
      // thread from the cut, so the worst case is the turn stays unfinished —
      // exactly where it was before this module existed.
      log(`warn: could not resume turn ${rec.turn_id}: ${e.message}`);
    }
  }
}

/** Rebuild the prompt: the original request, under the header that tells the
 *  model what its first life already did. */
function resumePrompt(rec) {
  return prependResumeHeader(rec.prompt, buildResumeHeader(rec));
}

async function resumeAgentTurn(rec, { projects, plugins, registries, config, log }) {
  const p = projects.get(rec.project_id);
  if (!p) throw new Error(`project ${rec.project_id} is no longer registered`);
  const agent = readAgents(p.path).find((a) => a.slug === rec.agent_slug);
  if (!agent) throw new Error(`agent ${rec.agent_slug} no longer exists`);

  // The thread as it stands NOW, which already contains the cut turn's partial:
  // the abort persisted it on the way down. So the model reads its own
  // interrupted message as history, and the header tells it what produced it.
  const conv = rec.conversation_id
    ? readConversation(p.storagePath, agent.slug, rec.conversation_id)
    : null;
  const history = (conv?.turns || [])
    .filter((t) => t.role === "user" || t.role === "assistant")
    .map((t) => ({ role: t.role, content: t.content }));

  const result = await runAgentTurn({
    p, agent,
    modelId: rec.model || agent.fields?.Model,
    system: buildAgentSystem(p, agent, { invocation: "engine" }),
    prompt: resumePrompt(rec),
    previousMessages: history,
    channel: rec.channel || CHANNELS.API,
    // What makes this a resume and not a re-run.
    priorEffects: rec.effects || [],
    projects, plugins, registries, config,
  });

  recordAgentTurn({
    project: p,
    agentSlug: agent.slug,
    agentName: agent.fields?.Name || agent.slug,
    channel: rec.channel || CHANNELS.API,
    model: result.model,
    prompt: rec.prompt,
    // The thread should show what was ASKED, not the machinery that re-asked
    // it: a reader scrolling back wants their own sentence, not a page of
    // "[interrupted turn]" scaffolding.
    filedPrompt: `[resumed after restart]\n\n${rec.prompt}`,
    reply: result.text,
    trace: result.trace,
    usage: result.usage,
    scope: { resumed_turn: rec.turn_id },
  });
  log(`resumed ${agent.slug}'s turn ${rec.turn_id} (${(rec.effects || []).length} tool(s) already done)`);
}

async function resumeSuperAgentTurn(rec, { projects, plugins, registries, config, log }) {
  const result = await runSuperAgent({
    globalConfig: config,
    projects, plugins, registries,
    prompt: resumePrompt(rec),
    channel: rec.channel || CHANNELS.API,
    priorEffects: rec.effects || [],
  });
  const p = projects.get(rec.project_id);
  if (p) {
    recordAgentTurn({
      project: p,
      agentSlug: "super_agent",
      actorKind: "superagent",
      // The super-agent's chats live in the ledger, not in per-agent
      // conversation files — writing one would invent a thread nothing reads.
      conversation: false,
      channel: rec.channel || CHANNELS.API,
      model: result.model,
      prompt: rec.prompt,
      filedPrompt: `[resumed after restart]\n\n${rec.prompt}`,
      reply: result.text,
      trace: result.trace,
      usage: result.usage,
      scope: { resumed_turn: rec.turn_id },
    });
  }
  log(`resumed super-agent turn ${rec.turn_id} (${(rec.effects || []).length} tool(s) already done)`);
}

/**
 * Claim and finish whatever the previous daemon left cut off.
 *
 * Returns a stop handle so the shutdown can cancel a pending start — otherwise
 * a restart-during-the-delay would relaunch the turns into a daemon already on
 * its way back down.
 */
export function startTurnResumer({ projects, plugins, registries, config, log }) {
  const timer = setTimeout(() => {
    const pending = claimResumableTurns();
    if (!pending.length) return;
    log(`resuming ${pending.length} turn(s) the last shutdown had to cut off`);
    const ctx = { projects, plugins, registries, config, log };
    resumeEach(
      pending,
      (rec) => (rec.surface === "super-agent"
        ? resumeSuperAgentTurn(rec, ctx)
        : resumeAgentTurn(rec, ctx)),
      log,
    ).catch((e) => log(`warn: turn resumer stopped: ${e.message}`));
  }, START_DELAY_MS);
  timer.unref();
  return () => clearTimeout(timer);
}
