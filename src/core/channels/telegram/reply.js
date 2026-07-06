// Shared Telegram super-agent reply path. Both the inbound dispatcher
// (handleUpdate) and the ask-flow resume (_runResumedTurn in the host poller)
// drive the SAME streamed turn through these helpers, so behavior — autonomy
// budget, streaming, never-silent floor, localized errors, rich channelMeta —
// can't drift between the two entry points. It did drift: the resume path was a
// stale hand-rolled copy that missed maxIters, streaming and i18n. One source
// of truth fixes that for good.
import { runSuperAgent } from "#core/agent/super-agent.js";
import { TELEGRAM_TOOL_ITERS } from "#core/agent/constants.js";
import { stripThinking } from "#core/util/thinking.js";
import { appendGlobalMessage, getRecentTelegramTurnsFromFs } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { createTelegramConfirmAdapter } from "#core/confirmation/adapters/telegram.js";
import { getConfirmationStore as getConfirmStore } from "#core/confirmation/pending-store.js";
import { t, resolveLang } from "#core/i18n/index.js";
import { buildTelegramMeta, resolveBotToken } from "./helpers.js";

/**
 * Build the streaming event handler for a Telegram super-agent turn. Sends a
 * one-shot localized heads-up the moment real work starts (first tool), streams
 * each assistant-text iteration as its own chat message, and logs tool calls
 * (audit trail / other channels — never sent to Telegram). Returns the handler
 * plus a live `state` the caller reads AFTER the run to drive the final send.
 *
 * @returns {{ onEvent: Function, state: { streamedCount: number, lastStreamedText: string } }}
 */
export function buildStreamHandler(self, { chat_id, update_id, agentDisplay }) {
  const state = { streamedCount: 0, lastStreamedText: "", sentHeadsUp: false };
  const onEvent = async (ev) => {
    try {
      if (ev.type === "tool_start" && !state.sentHeadsUp && state.streamedCount === 0) {
        state.sentHeadsUp = true;
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
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, heads_up: true },
        });
        return;
      }
      if (ev.type === "assistant_text" && ev.text) {
        const piece = stripThinking(ev.text).trim();
        if (!piece) return;
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
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, streamed: true, iteration: ev.iteration },
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
          meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, tool: tr.tool, args: tr.args, result: tr.result, iteration: ev.iteration },
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
    } catch (e) {
      self.log(`telegram[${self.channel.name}] a2a followup failed: ${e.message}`);
      replyText = telegramErrorText(self, e);
      replyAuthor = agentDisplay;
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
      streamedCount: state.streamedCount,
      lastStreamedText: state.lastStreamedText,
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
 * Send the final reply for a turn and log it. The intermediate prose was already
 * streamed, so we only send `replyText` if it's non-empty AND not a duplicate of
 * the last streamed piece. Never ends on silence: a turn that streamed/acted but
 * produced no closing gets a neutral "continue?"; a pure chit-chat turn that did
 * nothing gets a short ack. Caller stops the typing indicator before calling.
 */
export async function sendFinalReply(self, {
  chat_id, update_id, replyText, replyAuthor, replyActorId, replyKind,
  saUsage = null, streamedCount = 0, lastStreamedText = "", agentDisplay,
  extraMeta = {},
}) {
  const finalClean = replyText ? stripThinking(replyText).trim() : "";
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
    if (saUsage) meta.usage = saUsage;
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
      meta: { chat_id, tg_channel: self.channel.name, in_reply_to: update_id, send_error: e.message, ...(saUsage ? { usage: saUsage } : {}) },
    });
  }
}
