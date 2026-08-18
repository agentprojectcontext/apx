// Shared Telegram super-agent reply path. Both the inbound dispatcher
// (handleUpdate) and the ask-flow resume (_runResumedTurn in the host poller)
// drive the SAME streamed turn through these helpers, so behavior — autonomy
// budget, streaming, never-silent floor, localized errors, rich channelMeta —
// can't drift between the two entry points. It did drift: the resume path was a
// stale hand-rolled copy that missed maxIters, streaming and i18n. One source
// of truth fixes that for good.
import { runSuperAgent } from "#core/agent/super-agent.js";
import { TELEGRAM_TOOL_ITERS } from "#core/agent/constants.js";
import { stripThinking, stripReasoning } from "#core/util/thinking.js";
import { appendGlobalMessage, getRecentTelegramTurnsFromFs } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";
import { SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { createTelegramConfirmAdapter } from "#core/confirmation/adapters/telegram.js";
import { getConfirmationStore as getConfirmStore } from "#core/confirmation/pending-store.js";
import { t, resolveLang } from "#core/i18n/index.js";
import { buildTelegramMeta, resolveBotToken } from "./helpers.js";
import { createProgressGate, progressEveryMs } from "./progress-gate.js";

/**
 * Build the streaming event handler for a Telegram super-agent turn. ONE notice
 * goes out when work starts — the model's own opening line, or the canned
 * heads-up if it went straight to a tool — and the rest of the turn stays quiet
 * until the caller sends the closing message. The progress notes the model
 * writes before each later step are held back (see ./progress-gate.js for why,
 * and for the long-job heartbeat that lets one through every N seconds). Tool
 * calls are logged for the audit trail / other channels, never sent to Telegram.
 * Returns the handler plus a live `state` the caller reads AFTER the run to
 * drive the final send.
 *
 * `state.model` tracks the model actually answering RIGHT NOW (it can rotate
 * mid-turn on a fallback), so every record this handler writes is stamped with
 * the model that produced it — not with the one the turn happened to end on.
 *
 * @returns {{ onEvent: Function, state: { streamedCount: number, lastStreamedText: string, heldCount: number, model: string } }}
 */
export function buildStreamHandler(self, { chat_id, update_id, agentDisplay }) {
  const state = { streamedCount: 0, lastStreamedText: "", heldCount: 0, model: "" };
  const gate = createProgressGate({ everyMs: progressEveryMs(self.globalConfig) });
  const onEvent = async (ev) => {
    try {
      if ((ev.type === "model_start" || ev.type === "model_routed" || ev.type === "final_wrapup") && ev.model) {
        state.model = ev.model;
      }
      if (ev.type === "tool_start") {
        // Only ever the turn's opener: if the model already spoke, the gate
        // holds this and the user hears nothing more until the answer.
        if (gate.toolStart() !== "heads_up") return;
        const heads = t("telegram.heads_up", { lang: resolveLang(self.globalConfig) });
        await self._send({ chat_id, text: heads });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "agent",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author: agentDisplay,
          body: heads,
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, heads_up: true, ...(state.model ? { model: state.model } : {}) },
        });
        return;
      }
      if (ev.type === "assistant_text" && ev.text) {
        // Untagged planning is suppressed mid-stream too, or the user
        // watches the model think in real time.
        const piece = stripReasoning(ev.text).answer.trim();
        if (!piece) return;
        if (gate.text() === "hold") {
          // Held, not lost: it was a pre-tool filler line, and the closing
          // message carries the result. Logged by size only — the ledger
          // records what the user actually received, and the daemon log is
          // not the place to copy conversation text.
          state.heldCount += 1;
          self.log(
            `telegram[${self.channel.name}] progress note held ` +
            `(#${state.heldCount}, ${piece.length} chars, ${Math.round(gate.sinceLastMs() / 1000)}s of quiet)`
          );
          return;
        }
        await self._send({ chat_id, text: piece });
        state.lastStreamedText = piece;
        state.streamedCount += 1;
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "agent",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author: agentDisplay,
          body: piece,
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, streamed: true, iteration: ev.iteration, ...(state.model ? { model: state.model } : {}) },
        });
      } else if (ev.type === "tool_result" && ev.trace) {
        // Logged for the audit trail / other channels — NOT sent to Telegram.
        const tr = ev.trace;
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "tool",
          actor_id: tr.tool,
          actor_kind: "tool",
          author: agentDisplay,
          body: `${tr.tool}(${JSON.stringify(tr.args || {}).slice(0, 200)})`,
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, tool: tr.tool, args: tr.args, result: tr.result, iteration: ev.iteration, ...(state.model ? { model: state.model } : {}) },
        });
      } else if (ev.type === "engine_failed") {
        // A model in the fallback chain errored; the loop is rotating to the
        // next one. Log so a mid-turn provider failure is diagnosable.
        self.log(`telegram[${self.channel.name}] engine_failed: ${ev.model || "?"} (${ev.reason || "?"}) → ${ev.retry_with || "end of chain"}`);
      } else if (ev.type === "model_routed" || ev.type === "model_retry") {
        self.log(`telegram[${self.channel.name}] ${ev.type}: model=${ev.model || "?"}${ev.reason ? ` reason=${ev.reason}` : ""}${ev.from_fallback ? " (fallback)" : ""}`);
      }
    } catch (e) {
      // A failed intermediate send must not abort the whole run.
      self.log(`telegram[${self.channel.name}] stream event failed: ${e.message}`);
    }
  };
  return { onEvent, state };
}

/**
 * Run the super-agent for a Telegram turn with the canonical channel config:
 * the autonomy budget (telegram_max_iters → TELEGRAM_TOOL_ITERS), rich
 * channelMeta (project pin + route), the confirmation adapter, and streaming.
 * The single place this call is configured — change it once, both entry points
 * inherit it. Throws on failure (caller decides abort-vs-error handling).
 */
export function runTelegramSuperAgent(self, {
  chat_id, prompt, previousMessages, target, author, authorId, relationshipBlock,
  allowedTools, contextNote, signal, onEvent, backgroundResultSink = null,
  attachments = [],
}) {
  const confirmAdapter = createTelegramConfirmAdapter({
    token: resolveBotToken(self.channel),
    chatId: chat_id,
    pendingStore: getConfirmStore(),
    // Only the user who triggered this turn may answer its confirmations.
    guardActorId: authorId ?? null,
  });
  return runSuperAgent({
    globalConfig: self.globalConfig,
    projects: self.projects,
    plugins: self.plugins,
    registries: self.registries,
    prompt,
    previousMessages,
    attachments,
    channel: CHANNELS.TELEGRAM,
    relationshipBlock,
    allowedTools,
    contextNote: contextNote || undefined,
    channelMeta: buildTelegramMeta({
      channelName: self.channel.name,
      author,
      chatId: chat_id,
      target,
      routeToAgent: self.channel.route_to_agent,
    }),
    signal,
    onEvent,
    requestConfirmation: confirmAdapter.requestConfirmation,
    backgroundResultSink,
    // Autonomy budget: Telegram is the "do the whole task for me" surface, so it
    // gets a real multi-step budget instead of the conversational default (which
    // cut tasks off after ~9 actions to ask "continue?"). Tunable via
    // config.super_agent.telegram_max_iters.
    maxIters: Number(self.globalConfig?.super_agent?.telegram_max_iters) || TELEGRAM_TOOL_ITERS,
  });
}

/**
 * Run a follow-up super-agent turn triggered internally (not by an inbound
 * message) — the A2A callback path. A background tool (call_runtime) finished
 * out of band; `reportText` is the sub-agent/runtime result phrased as an
 * internal report. We log it as a synthetic inbound so it lands in history,
 * then run a normal streamed turn so Roby relays it to the user in its own
 * voice (and can chain the next step). The same `backgroundResultSink` is
 * forwarded so a relay turn that delegates again keeps the A2A loop intact.
 * Best-effort: never throws (nothing awaits it).
 */
export async function runFollowupTurn(self, {
  chat_id, reportText, target, author, authorId, relationshipBlock,
  allowedTools, agentDisplay, update_id, backgroundResultSink = null,
}) {
  if (!chat_id || !reportText) return;
  try {
    // Synthetic inbound so the report is part of the rolling history. Tagged
    // a2a_callback + a distinct author so it reads as an internal hand-off, not
    // a user turn.
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "in",
      type: "user",
      actor_id: "a2a",
      external_id: `a2a-${update_id}-${chat_id}`,
      author: "a2a",
      body: reportText,
      meta: { chat_id, tg_channel: self.channel.name, a2a_callback: true },
    });

    const previousMessages = getRecentTelegramTurnsFromFs({ chat_id, keepRecent: 40, max_age_hours: 24 });
    const { onEvent, state } = buildStreamHandler(self, { chat_id, update_id, agentDisplay });
    const stopTyping = self._startTyping(chat_id);
    let replyText;
    let replyAuthor;
    let saUsage = null;
    let saModel = null;
    let saTrace = null;
    try {
      const sa = await runTelegramSuperAgent(self, {
        chat_id,
        prompt: reportText,
        previousMessages,
        target,
        author,
        authorId,
        relationshipBlock,
        allowedTools,
        onEvent,
        backgroundResultSink,
      });
      replyText = sa.text;
      replyAuthor = sa.name || agentDisplay;
      saUsage = sa.usage;
      saModel = sa.model || state.model || null;
      saTrace = sa.trace || null;
    } catch (e) {
      self.log(`telegram[${self.channel.name}] a2a followup failed: ${e.message}`);
      replyText = telegramErrorText(self, e);
      replyAuthor = agentDisplay;
      saModel = state.model || null;
    }
    stopTyping();
    await sendFinalReply(self, {
      chat_id,
      update_id,
      replyText,
      replyAuthor,
      replyActorId: SUPERAGENT_ACTOR_ID,
      replyKind: "superagent",
      saUsage,
      saModel,
      saTrace,
      streamedCount: state.streamedCount,
      lastStreamedText: state.lastStreamedText,
      heldCount: state.heldCount,
      agentDisplay,
      extraMeta: { a2a_relay: true },
    });
  } catch (e) {
    self.log(`telegram[${self.channel.name}] a2a followup crashed: ${e.message}`);
  }
}

/** Localized "couldn't reply" text for a failed super-agent turn (model itself
 * failed, so it can't author this — templated, but follows the user's language). */
export function telegramErrorText(self, e) {
  return t("telegram.error_generic", {
    lang: resolveLang(self.globalConfig),
    vars: { error: e?.message || "internal error" },
  });
}

/**
 * Send the final reply for a turn and log it. The opening notice was already
 * sent, so we only send `replyText` if it's non-empty AND not a duplicate of
 * the last piece that went out. This is the message the whole turn is for: with
 * mid-turn notes held back, it's the only place the result can arrive — hence
 * the never-silent floor. A turn that acted but produced no closing gets a
 * neutral "continue?"; a pure chit-chat turn that did nothing gets a short ack.
 * Caller stops the typing indicator before calling.
 */
export async function sendFinalReply(self, {
  chat_id, update_id, replyText, replyAuthor, replyActorId, replyKind,
  saUsage = null, saModel = null, saTrace = null, streamedCount = 0, lastStreamedText = "",
  heldCount = 0, agentDisplay, extraMeta = {},
}) {
  // A model that dumps raw planning must never have it forwarded. When that
  // happens the answer comes back empty and the existing never-silent fallback
  // below sends a short line instead — a worse reply, but not the model's notes.
  const stripped = replyText ? stripReasoning(replyText) : { answer: "", leaked: false };
  const finalClean = stripped.answer.trim();
  if (stripped.leaked) {
    // eslint-disable-next-line no-console
    console.warn(
      `[apx] telegram: suppressed an untagged reasoning dump from ${saModel || "the model"} ` +
      `(${replyText.length} chars). Check the model chain — a router that returns raw ` +
      `chain-of-thought is not usable on a user-facing channel.`
    );
  }
  let toSend = "";
  if (finalClean && finalClean !== lastStreamedText) {
    toSend = finalClean;
  } else if (!finalClean) {
    const lang = resolveLang(self.globalConfig);
    toSend = streamedCount === 0
      ? t("telegram.fallback_listo", { lang })
      : t("telegram.fallback_continue", { lang });
  }
  if (!toSend) return; // everything was already streamed — nothing left to send

  const actorId = replyActorId || SUPERAGENT_ACTOR_ID;
  const kind = replyKind || "superagent";
  try {
    await self._send({ chat_id, text: toSend });
    const meta = { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, final: true, ...extraMeta };
    if (replyText && stripThinking(replyText) !== replyText) meta.thinking_stripped = true;
    if (stripped.leaked) meta.reasoning_leak_suppressed = true;
    if (saUsage) meta.usage = saUsage;
    if (saModel) meta.model = saModel;
    // A COMPACT summary, not the trace: the full one carries args and results
    // and would bloat the day-file for a detail nobody reads back. What is
    // worth recovering later is "it read three files and sent a message", and
    // whether any of it failed.
    const toolSummary = summarizeToolTrace(saTrace);
    if (toolSummary) meta.tool_summary = toolSummary;
    // How many progress notes the gate held back. The ledger stays a record of
    // what the user RECEIVED; this number is how you tell, after the fact, that
    // a quiet turn was quiet on purpose.
    if (heldCount > 0) meta.progress_held = heldCount;
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "out",
      type: "agent",
      actor_id: actorId,
      actor_kind: kind,
      agent_slug: actorId,
      author: replyAuthor || agentDisplay,
      body: toSend,
      meta,
    });
  } catch (e) {
    self.log(`telegram[${self.channel.name}] send-back error: ${e.message}`);
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "out",
      type: "agent",
      actor_id: actorId,
      actor_kind: kind,
      agent_slug: actorId,
      author: replyAuthor || agentDisplay,
      body: `[send_failed] ${toSend}`,
      meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, send_error: e.message, ...(saUsage ? { usage: saUsage } : {}), ...(saModel ? { model: saModel } : {}) },
    });
  }
}
