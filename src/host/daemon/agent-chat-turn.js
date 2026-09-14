// A turn in a project agent's own chat, for callers that are not an HTTP route.
//
// These five helpers were local to api/exec.js while its three routes were the
// only things that took a turn in an agent's conversation. A background shell
// job's wake-up is the second caller (see shell-job-wake.js): when a render the
// agent left running exits, the agent has to come back IN THE CHAT IT LEFT —
// same conversation file, same history, same system prompt, same live frames on
// the panel — and continue.
//
// Copying that plumbing into the wake-up was the obvious move and the wrong one.
// Everything about a turn that is easy to forget is in here: the compacted
// summary going into the system prompt instead of being replayed as a turn, the
// closing floor so an empty turn is not filed as an answer, the active-turn
// registration that lets a reopened tab follow a run it did not start. A second
// copy would have drifted from the first the week after it was written, and the
// drift would only show as "the woken turn behaves slightly differently", on a
// surface nobody is watching at the time.
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { runAgentTurn } from "#core/agent/run-turn.js";
import { floorReplyText } from "#core/agent/closing-floor.js";
import { startConversation, appendTurn, readConversation } from "#core/stores/conversations.js";
import { buildTurnAttribution, appendAgentReplyToConversation } from "#core/stores/turn-record.js";
import { attachmentsMeta } from "#core/stores/media-archive.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  startActiveTurn, appendActiveTurn, recordActiveTurnEvent, isVisibleTurnEvent,
  endActiveTurn, convTurnKey,
} from "./active-turns.js";
import { broadcastTurn } from "./events-ws.js";

/** Open (or start) the conversation this turn belongs to. */
export function openConversation({ p, agent, modelId, system, conversationId, channel }) {
  if (!conversationId) {
    const conv = startConversation({
      storagePath: p.storagePath,
      agentSlug: agent.slug,
      engine: modelId,
      system,
      channel,
    });
    return { path: conv.path, id: conv.id, history: [], compactSummary: null };
  }
  const existing = readConversation(p.storagePath, agent.slug, conversationId);
  if (!existing) return null;
  // Inject compact summary into system instead of replaying it as a turn.
  const compactTurn = existing.turns.find((t) => t.role === "compact");
  const compactSummary = compactTurn
    ? compactTurn.content.replace(/^\[Compacted \d+ turns.*?\]\n\n?/, "").trim()
    : null;
  return {
    path: existing.path,
    id: conversationId,
    history: existing.turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => ({ role: t.role, content: t.content })),
    compactSummary,
  };
}

/** Everything both chat endpoints need before the model is called. */
export function prepareChatTurn({ p, agent, modelId, conversation_id, channel }) {
  // The system prompt has to exist before the conversation file that records
  // it, and the compacted summary has to be inside it — so the file is opened
  // first when it already exists, and created after when it does not.
  const existing = conversation_id
    ? openConversation({ p, agent, modelId, system: "", conversationId: conversation_id, channel })
    : null;
  if (conversation_id && !existing) return null;

  const extraParts = existing?.compactSummary
    ? [`## Previous Conversation Context (Compacted)\n${existing.compactSummary}`]
    : [];
  const system = buildAgentSystem(p, agent, { invocation: "engine", extraParts });

  const conv =
    existing ||
    openConversation({ p, agent, modelId, system, conversationId: null, channel });
  return { system, conv };
}

/** The attribution a reopened conversation renders from. */
export function turnAttribution(agent, result) {
  return buildTurnAttribution({
    agentSlug: agent.slug,
    agentName: agent.fields?.Name || agent.slug,
    model: result.model,
    usage: result.usage,
    trace: result.trace,
  });
}

/**
 * The never-silent floor, in the agent's own voice.
 *
 * runAgent re-prompts a dud turn and then gives up, and what came back went
 * straight into the thread: an empty bubble in the panel and an empty assistant
 * row on disk, which the next turn reads back as the answer this one gave. The
 * closing is asked of the model first — the AGENT's model, because this thread
 * is in its voice and not the super-agent's — and the canned line goes out only
 * if that comes back empty too.
 *
 * A turn with a real answer is returned untouched and costs no model call.
 * Deliberately NOT used on the abort path: an interrupted turn that wrote
 * nothing is meant to leave no bubble at all.
 *
 * @returns {object} the same result, with `text` guaranteed non-empty
 */
export async function withClosingFloor({ p, agent, modelId, config, result, streamedText = "" }) {
  const closing = await floorReplyText({
    globalConfig: p.config || config,
    model: result.model || modelId,
    text: result.text,
    streamedText,
    trace: result.trace,
  });
  if (!closing.floored) return result;
  // eslint-disable-next-line no-console
  console.warn(
    `[apx] ${agent.slug}: empty turn closed by the floor — ` +
    (closing.authored
      ? "the model wrote the closing"
      : "the canned floor spoke, the model could not write it either")
  );
  return { ...result, text: closing.text };
}

/** Collect the last thing the turn actually SAID. The result carries the
 *  closing, so this is the one piece of context a floored closing needs. */
export function lastSaidCollector() {
  const seen = { text: "" };
  return [seen, (ev) => {
    if (ev?.type === "assistant_text" && String(ev.text || "").trim()) seen.text = String(ev.text).trim();
  }];
}

export function persistAgentReply({ filePath, agent, result }) {
  // Images the agent attached to THIS reply (attach_media). Archived into
  // ~/.apx/media on the way, because a skill's picture lives beside its
  // SKILL.md and the media endpoint serves nothing from outside the media dir —
  // the row would name a file the viewer is not allowed to fetch.
  const attribution = { ...turnAttribution(agent, result), ...attachmentsMeta(result.media) };
  appendAgentReplyToConversation({
    filePath,
    reply: result.text,
    trace: result.trace,
    attribution,
  });
  return attribution;
}

/**
 * Run one turn in an agent's chat on nobody's behalf — no request, no socket.
 *
 * The same turn the `/chat` routes run, minus the parts that only mean
 * something to an HTTP client: there is no NDJSON stream and no confirmation
 * round-trip, because there is no caller on the other end to read one or answer
 * the other. What IS kept is everything a WATCHER needs — the turn is
 * registered in the active-turn registry and its events are pushed over the
 * shared feed — so a chat somebody has open sees this turn arrive, think, call
 * its tools and answer, exactly like one they typed themselves.
 *
 * `conversationId` may be null, and then this opens a new chat thread for the
 * agent. That is the honest fallback for work launched somewhere without a
 * conversation of its own (a routine, a Telegram turn): the result surfaces in
 * a thread the owner can find rather than being dropped for want of an address.
 *
 * Confirmation is `null` on purpose: nobody is at the other end to answer a
 * prompt, so a tool that needs one falls back to the configured policy rather
 * than hanging a turn nobody asked for on a dialog nobody will see.
 *
 * @returns {Promise<{conversation_id, text, result}>}
 */
export async function runChatTurn({
  p,
  agent,
  modelId,
  conversationId = null,
  channel = CHANNELS.API,
  channelMeta = null,
  prompt,
  /** Stamped on the turn that opens this run. A turn nobody typed should say so
   *  on the record, even while the panel still draws it as an ordinary one. */
  promptMeta = null,
  config,
  projects,
  plugins,
  registries,
  maxIters,
  signal = null,
  runAgentTurnFn = runAgentTurn,
}) {
  // The conversation named by the caller may be gone (deleted, or a project that
  // moved), and `prepareChatTurn` answers null for one it cannot open. Start a
  // new thread rather than losing the turn: the point of this function is that
  // something already happened and somebody has to hear about it.
  const turn =
    prepareChatTurn({ p, agent, modelId, conversation_id: conversationId, channel }) ||
    prepareChatTurn({ p, agent, modelId, conversation_id: null, channel });

  appendTurn({ filePath: turn.conv.path, role: "user", content: prompt, meta: promptMeta || undefined });

  // The Stop button on this chat has to reach this turn too. A woken turn is
  // one nobody asked for at the moment it starts — which is exactly the kind
  // somebody wants to be able to stop.
  const turnAbort = new AbortController();
  if (signal) {
    if (signal.aborted) turnAbort.abort();
    else signal.addEventListener("abort", () => turnAbort.abort(), { once: true });
  }
  const turnKey = convTurnKey(p.id, turn.conv.id);
  const active = startActiveTurn(turnKey, {
    project_id: p.id,
    agent_slug: agent.slug,
    conversation_id: turn.conv.id,
    model: modelId,
    abort: () => turnAbort.abort(),
    prompt,
    channel,
    surface: "agent",
  });
  const turnFrame = (phase, extra) => broadcastTurn({
    phase, project_id: p.id, agent_slug: agent.slug, conversation_id: turn.conv.id,
    turn_id: active.id, ...extra,
  });
  turnFrame("start");

  const [said, observeSaid] = lastSaidCollector();
  try {
    const raw = await runAgentTurnFn({
      p, agent, modelId,
      system: turn.system,
      prompt,
      previousMessages: turn.conv.history,
      channel,
      channelMeta: { ...(channelMeta || {}), conversation_id: turn.conv.id },
      maxIters,
      projects, plugins, registries, config,
      signal: turnAbort.signal,
      onEvent: (ev) => {
        recordActiveTurnEvent(active.id, ev);
        if (isVisibleTurnEvent(ev)) turnFrame("event", { event: ev });
        observeSaid(ev);
      },
      onToken: (chunk) => { appendActiveTurn(active.id, chunk); turnFrame("delta", { delta: chunk }); },
      requestConfirmation: null,
    });
    const result = await withClosingFloor({ p, agent, modelId, config, result: raw, streamedText: said.text });
    persistAgentReply({ filePath: turn.conv.path, agent, result });
    projects?.rebuild?.(p.id);

    const finalResult = {
      conversation_id: turn.conv.id,
      text: result.text,
      usage: result.usage,
      name: agent.slug,
      model: result.model,
      trace: result.trace,
    };
    turnFrame("final", { result: finalResult });
    return { conversation_id: turn.conv.id, text: result.text, result };
  } catch (e) {
    turnFrame("error", { error: e.message });
    throw e;
  } finally {
    endActiveTurn(active.id);
  }
}
