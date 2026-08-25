// One writer for one agent turn: prompt in, tools, answer out.
//
// A turn is recorded in two places and they answer different questions. The
// CONVERSATION FILE is the thread you reopen — the chat list's Schedule group,
// the session picker, `apx conversations`. The LEDGER is the cross-channel
// record — search, the RAG index, the inbox, "what has been going on today".
// Both have to hear about the same turn, and both have to hear the same thing.
//
// This existed twice. The web path wrote the ledger with full attribution
// (model, usage, tool summary — see api/super-agent.js `logWebTurn`); the
// routine runner had its own private pair, and its file half wrote text and
// nothing else. So a scheduled run — the one turn nobody watched stream, the
// one where the stored record is the ONLY record — opened as "0 tok", no model,
// no actor. A routine's turn is not a lesser kind of turn; it goes through the
// same treatment as a message typed by hand, and this is that treatment.
import {
  startConversation,
  appendTurn,
  setStatus,
} from "#core/stores/conversations.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";

/** Attribution every writer stamps on the assistant row — model, usage, tool summary. */
export function buildTurnAttribution({ agentSlug, agentName, model, usage, trace = [] }) {
  const steps = Array.isArray(trace) ? trace.filter((s) => s?.tool) : [];
  const toolSummary = summarizeToolTrace(steps);
  return {
    agent: agentSlug,
    agent_name: agentName || agentSlug,
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(toolSummary ? { tool_summary: toolSummary } : {}),
  };
}

/** Append tool rows then the assistant answer to an open conversation file. */
export function appendAgentReplyToConversation({ filePath, reply, trace = [], attribution }) {
  const steps = Array.isArray(trace) ? trace.filter((s) => s?.tool) : [];
  for (const step of steps) {
    appendTurn({
      filePath,
      role: "tool",
      content: JSON.stringify({
        tool: step.tool,
        args: step.args || {},
        result: step.result,
      }),
    });
  }
  appendTurn({
    filePath,
    role: "assistant",
    content: reply || "",
    meta: attribution,
  });
}

/**
 * Record a complete agent turn to the conversation file and the project ledger.
 *
 * @param {object}   o
 * @param {object}   o.project       ProjectManager entry — needs `storagePath`
 *                                   for the file half and `logMessage` for the
 *                                   ledger half. Either may be missing; each
 *                                   half is written only when it can be.
 * @param {string}   o.agentSlug     Who answered (conversation owner + actor id).
 * @param {string}  [o.agentName]    Display name. Defaults to the slug — the
 *                                   record always carries one.
 * @param {string}   o.channel       Channel the turn happened on.
 * @param {string}  [o.title]        Conversation title (a routine passes its name).
 * @param {string}  [o.model]        Model that produced the reply.
 * @param {string}   o.prompt        What the agent was asked.
 * @param {string}  [o.filedPrompt]  The prompt as the THREAD should show it, when
 *                                   the thread wants a label the ledger doesn't
 *                                   ("[routine: nightly]\n\n…"). Defaults to `prompt`.
 * @param {string}  [o.reply]        What it answered.
 * @param {object[]}[o.trace]        Tool calls, in order.
 * @param {object}  [o.usage]        { input_tokens, output_tokens }.
 * @param {object}  [o.scope]        Extra meta stamped on every ledger row
 *                                   (e.g. `{ routine: name }`).
 * @param {string}  [o.actorKind]    "agent" (default) or "superagent" — the
 *                                   super-agent is not a project agent and its
 *                                   rows have always said so.
 * @param {boolean} [o.conversation] Write the reopenable thread. False for an
 *                                   actor whose chats live in the ledger rather
 *                                   than in per-agent files (the super-agent).
 * @returns {{ conversationId: string|null, toolSummary: object|null }}
 */
export function recordAgentTurn({
  project,
  agentSlug,
  agentName,
  channel,
  title,
  model,
  prompt,
  filedPrompt,
  reply = "",
  trace = [],
  usage,
  scope = {},
  actorKind = "agent",
  conversation = true,
}) {
  const steps = Array.isArray(trace) ? trace.filter((s) => s?.tool) : [];
  const toolSummary = summarizeToolTrace(steps);
  const attribution = buildTurnAttribution({ agentSlug, agentName, model, usage, trace: steps });

  const conversationId = conversation
    ? writeConversation({
        storagePath: project?.storagePath,
        agentSlug,
        channel,
        title,
        model,
        prompt: filedPrompt ?? prompt,
        reply,
        steps,
        attribution,
      })
    : null;

  writeLedger({
    project,
    agentSlug,
    agentName,
    actorKind,
    channel,
    prompt,
    reply,
    steps,
    attribution,
    scope: { ...scope, ...(conversationId ? { conversation: conversationId } : {}) },
  });

  return { conversationId, toolSummary };
}

/** The thread you reopen. One file per turn for a routine (each run stands on
 *  its own); `null` when there is nowhere to put it. */
function writeConversation({ storagePath, agentSlug, channel, title, model, prompt, reply, steps, attribution }) {
  if (!storagePath || !agentSlug) return null;
  try {
    const conv = startConversation({
      storagePath,
      agentSlug,
      engine: model,
      channel,
      title,
    });
    appendTurn({ filePath: conv.path, role: "user", content: prompt });
    appendAgentReplyToConversation({
      filePath: conv.path,
      reply,
      trace: steps,
      attribution,
    });
    setStatus(conv.path, "closed");
    return conv.id;
  } catch {
    // Storage is best-effort at the edges — losing the file must not fail the
    // run that produced it. The caller still gets its reply.
    return null;
  }
}

/** The cross-channel record: what search, the RAG index and the inbox read. */
function writeLedger({ project, agentSlug, agentName, actorKind, channel, prompt, reply, steps, attribution, scope }) {
  if (!project?.logMessage) return;
  try {
    project.logMessage({
      agent_slug: agentSlug,
      channel,
      direction: "in",
      type: "user",
      author: "user",
      body: prompt,
      meta: scope,
    });
    // One row per step — the same shape every other channel writes, which is
    // what lets a reopened thread render the work instead of a bare answer.
    for (const step of steps) {
      project.logMessage({
        agent_slug: agentSlug,
        channel,
        direction: "out",
        type: "tool",
        actor_id: step.tool,
        actor_kind: "tool",
        author: agentName || agentSlug,
        body: `${step.tool}(${JSON.stringify(step.args || {}).slice(0, 200)})`,
        meta: { ...scope, tool: step.tool, args: step.args, result: step.result },
      });
    }
    project.logMessage({
      agent_slug: agentSlug,
      channel,
      direction: "out",
      type: "agent",
      actor_id: agentSlug,
      actor_kind: actorKind,
      author: agentName || agentSlug,
      body: reply || "",
      meta: { ...scope, ...attribution, ...(steps.length ? { tool_trace: steps } : {}) },
    });
  } catch {
    /* best-effort: a ledger write must never break the run */
  }
}
