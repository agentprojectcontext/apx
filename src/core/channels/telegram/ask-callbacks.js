// ask_questions flow orchestration for Telegram, extracted from the host poller
// so that file stays focused on process lifecycle. Like dispatch.js, every
// function takes the poller instance (`self`) and reaches its I/O surface
// (self._send / _editKeyboard / _answerCallback / _startTyping) and config
// through it. The flow's own state machine lives in ./ask.js; this is the glue
// that turns its decisions into Telegram messages and re-enters the reply path.
import * as askFlow from "./ask.js";
import { resolveBotToken } from "./helpers.js";
import { buildStreamHandler, runTelegramSuperAgent, telegramErrorText, sendFinalReply } from "./reply.js";
import { createTelegramConfirmAdapter } from "#core/confirmation/adapters/telegram.js";
import { getConfirmationStore as getConfirmStore } from "#core/confirmation/pending-store.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";

/**
 * Route an inbound callback_query. ask_questions button presses are handled
 * here; everything else falls through to the confirmation adapter. Both use
 * `apx:<verb>:...` namespacing but the ask flow owns its own state.
 */
export async function handleCallbackQuery(self, callbackQuery) {
  const data = callbackQuery.data || "";
  if (data.startsWith("apx:ask:")) {
    await handleAskCallback(self, callbackQuery);
    return;
  }
  const adapter = createTelegramConfirmAdapter({
    token: resolveBotToken(self.channel),
    chatId: callbackQuery.message?.chat?.id,
    pendingStore: getConfirmStore(),
  });
  const handled = await adapter.handleCallbackQuery(callbackQuery);
  if (!handled) {
    self.log(`telegram[${self.channel.name}] unhandled callback_query: ${callbackQuery.data}`);
  }
}

/**
 * Draw the current question as a fresh message with its inline keyboard, wiping
 * the previous question's keyboard so the chat reads as a clean history.
 */
export async function renderQuestion(self, state) {
  const text = askFlow.formatQuestionText(state);
  const reply_markup = askFlow.buildKeyboard(state);
  if (state.messageId) {
    try {
      await self._editKeyboard({
        chat_id: state.chatId,
        message_id: state.messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch { /* best-effort */ }
  }
  const sent = await self._send({ chat_id: state.chatId, text, reply_markup, parse_mode: "Markdown" });
  state.messageId = sent?.message_id || null;
  askFlow.saveState(state.chatId, state);
}

/**
 * Kick off a brand-new ask flow after the super-agent called ask_questions. The
 * flow's `resume` callback captures the per-turn context so when the compiled
 * answer arrives we run another super-agent turn without retyping the inputs.
 */
export async function startAskFlow(self, ctx) {
  const state = askFlow.startFlow({
    chatId: ctx.chat_id,
    projectId: ctx.projectId,
    authorId: ctx.authorId,
    questions: ctx.questions,
    resume: async (compiled) => {
      await runResumedTurn(self, { ...ctx, compiled });
    },
  });
  await renderQuestion(self, state);
}

/** Apply an inline-keyboard press, then react: redraw, advance, cancel or finish. */
export async function handleAskCallback(self, callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  if (!chatId) return;
  const result = askFlow.applyCallback(chatId, callbackQuery.data || "");
  // Ack the press regardless — keeps the spinner from hanging client-side.
  await self._answerCallback({ callback_query_id: callbackQuery.id });
  if (!result) return; // stale or unknown — adapter already ack'd.

  if (result.action === "redraw") {
    // Multi-select toggle: refresh the keyboard on the SAME message.
    try {
      await self._editKeyboard({
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
        reply_markup: askFlow.buildKeyboard(result.state),
      });
    } catch (e) {
      self.log(`telegram[${self.channel.name}] redraw failed: ${e.message}`);
    }
    return;
  }
  if (result.action === "advance") {
    await renderQuestion(self, result.state);
    return;
  }
  if (result.action === "cancel") {
    try {
      await self._editKeyboard({
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
        reply_markup: { inline_keyboard: [] },
      });
      await self._send({ chat_id: chatId, text: "Pregunta cancelada." });
    } catch { /* best-effort */ }
    return;
  }
  if (result.action === "done") {
    try {
      await self._editKeyboard({
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    } catch { /* best-effort */ }
    // Feed the compiled answer back as a synthetic user turn.
    if (typeof result.state.resume === "function") {
      await result.state.resume(result.compiled);
    }
  }
}

/**
 * Apply a free-text user reply when there's a pending free-text question.
 * Returns true iff the message was consumed by the ask flow (so the normal
 * super-agent path should be skipped for this update).
 */
export async function maybeConsumeAskTextAnswer(self, { chat_id, text }) {
  if (!chat_id || !text) return false;
  if (!askFlow.hasPendingFreeText(chat_id)) return false;
  const state = askFlow.applyTextAnswer(chat_id, text);
  if (!state) return false;
  // Advance: emit a synthetic "next" to move past this question.
  const next = askFlow.applyCallback(chat_id, `apx:ask:${state.correlationId}:next`);
  if (!next) return true;
  if (next.action === "advance") {
    await renderQuestion(self, next.state);
    return true;
  }
  if (next.action === "done") {
    if (typeof next.state.resume === "function") {
      await next.state.resume(next.compiled);
    }
    return true;
  }
  return true;
}

/**
 * Run a follow-up super-agent turn with the compiled answers as the user prompt.
 * Shares the exact reply path as a normal inbound turn (./reply.js) — only the
 * photo/audio/reset preamble is skipped. Re-enters the ask flow if the model
 * decides to ask again.
 */
export async function runResumedTurn(self, ctx) {
  const { chat_id, compiled, target, relationshipBlock, allowedTools, author, agentDisplay, update_id, sender, authorId } = ctx;
  if (!chat_id) return;
  // Log the synthetic user message so getRecentTelegramTurnsFromFs picks it up
  // on the NEXT inbound. Mirrors how a normal text reply would be recorded.
  appendGlobalMessage({
    channel: CHANNELS.TELEGRAM,
    direction: "in",
    type: "user",
    actor_id: authorId ? String(authorId) : (author || "ask_flow"),
    external_id: `ask-${Date.now()}`,
    author: author || "user",
    body: compiled,
    meta: { chat_id, user_id: authorId || null, tg_channel: self.channel.name, ask_flow: true },
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
      prompt: compiled,
      previousMessages,
      target,
      author,
      relationshipBlock,
      allowedTools,
      onEvent,
    });

    // Did the model ask again? Restart the flow instead of replying.
    const followupAsk = askFlow.extractAskQuestionsFromTrace(sa.trace);
    if (followupAsk) {
      stopTyping();
      await startAskFlow(self, {
        chat_id,
        projectId: target?.id,
        authorId,
        questions: followupAsk,
        author,
        agentDisplay,
        relationshipBlock,
        allowedTools,
        target,
        sender,
        update_id,
      });
      return;
    }
    replyText = sa.text;
    replyAuthor = sa.name || agentDisplay;
    saUsage = sa.usage;
  } catch (e) {
    self.log(`telegram[${self.channel.name}] ask resume failed: ${e.message}`);
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
    extraMeta: { ask_resume: true },
  });
}
