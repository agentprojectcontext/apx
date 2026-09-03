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
import { applyNudgeCallback } from "#core/nudge/index.js";
import { recordDelivery } from "#core/stores/deliveries.js";
import { silenceMobilityToday } from "#core/mobility/preferences.js";
import { getMobilityAlert, recordMobilityResponse } from "#core/mobility/state.js";
import { answerMobilityAlert } from "#core/mobility/answer.js";
import { doneTask } from "#core/stores/tasks.js";
import { resolveLang } from "#core/i18n/index.js";

/**
 * The label the user actually tapped, recovered from the keyboard attached to
 * the message. `callback_data` is a routing slug ("mover_workspace_hoy"); the
 * label is what the human read ("Mover al workspace de hoy"), and that is the
 * better thing to hand an agent.
 */
export function buttonLabelFor(callbackQuery) {
  const rows = callbackQuery?.message?.reply_markup?.inline_keyboard || [];
  const data = callbackQuery?.data;
  for (const row of rows) {
    for (const btn of row || []) {
      if (btn?.callback_data === data && btn?.text) return String(btn.text);
    }
  }
  return "";
}

/**
 * Route an inbound callback_query. ask_questions button presses are handled
 * here; `apx:`-namespaced presses belong to an APX flow (ask / nudge /
 * confirmation) and never reach the agent. Anything else is a button someone
 * else put in the chat, and is treated as a user turn.
 *
 * TELEGRAM CONTRACT: every callback_query must be answered, handled or not.
 * Until it is, the client keeps the button spinning and the tap looks dead —
 * which is exactly how "the inline buttons do nothing" is reported. Nothing
 * below may return without an `_answerCallback`.
 */
export async function handleCallbackQuery(self, callbackQuery) {
  const data = callbackQuery.data || "";
  if (data.startsWith("apx:ask:")) {
    await handleAskCallback(self, callbackQuery);
    return;
  }
  if (data.startsWith("apx:nudge:")) {
    await handleNudgeCallback(self, callbackQuery);
    return;
  }
  if (data.startsWith("apx:mobility:")) {
    await handleMobilityCallback(self, callbackQuery);
    return;
  }
  const adapter = createTelegramConfirmAdapter({
    token: resolveBotToken(self.channel),
    chatId: callbackQuery.message?.chat?.id,
    pendingStore: getConfirmStore(),
  });
  const handled = await adapter.handleCallbackQuery(callbackQuery);
  if (handled) return;

  // `apx:noop` is a deliberately dead button (a disabled confirmation, an
  // expired panel). Ack it so the spinner clears and stop there — replaying it
  // to the agent would answer a question that is already closed.
  if (data === "apx:noop" || data.startsWith("apx:")) {
    await self._answerCallback({ callback_query_id: callbackQuery.id });
    self.log(`telegram[${self.channel.name}] stale apx callback: ${data}`);
    await clearKeyboard(self, callbackQuery);
    return;
  }

  // A button APX did not send — an agent-authored keyboard, another tool
  // posting into this chat. Ack first (never leave it spinning), then let the
  // press be a turn: re-enter the normal inbound path with the button's label
  // as the text, so identity, routing and the agent loop all apply unchanged.
  await self._answerCallback({ callback_query_id: callbackQuery.id });
  const text = buttonLabelFor(callbackQuery) || data;
  const chat = callbackQuery.message?.chat;
  if (!chat?.id || !text) {
    self.log(`telegram[${self.channel.name}] unhandled callback_query: ${data}`);
    return;
  }
  self.log(`telegram[${self.channel.name}] button press → turn: ${data} (${text})`);
  await self._handleUpdate({
    update_id: callbackQuery.id,
    message: {
      message_id: callbackQuery.message?.message_id,
      from: callbackQuery.from,
      chat,
      date: Math.floor(Date.now() / 1000),
      text,
    },
  });
}

/**
 * A proximity chip: "voy" / "hoy no" while driving, "hecho" / "todavía no"
 * when the follow-up comes back after the trip. Each one carries the alert id
 * (apx:mobility:<action>:<id>) because the answer has to land on the ONE place
 * it was asked about — the owner can have two of these open at once, and a
 * bare "yes" would close whichever came last.
 */
export async function handleMobilityAlertCallback(self, callbackQuery, action, alertId) {
  const lang = resolveLang(self.globalConfig);
  const alert = getMobilityAlert(alertId);
  if (!alert) {
    await self._answerCallback({ callback_query_id: callbackQuery.id });
    await clearKeyboard(self, callbackQuery);
    self.log(`telegram[${self.channel.name}] mobility alert ${alertId} is gone`);
    return;
  }

  // The answer itself lives in core (core/mobility/answer.js) so a tap here
  // and a tap on the car card mean the same thing. This adapter supplies the
  // one piece core cannot have: resolving the project a task lives in.
  const { ack } = answerMobilityAlert(alertId, action, {
    lang,
    closeTask: (target) => {
      const closed = closeAlertTask(self, target);
      if (!closed) self.log(`telegram[${self.channel.name}] mobility task ${target.task_id} not found — nothing closed`);
      return closed;
    },
  });
  await self._answerCallback({ callback_query_id: callbackQuery.id, text: ack });
  await clearKeyboard(self, callbackQuery);
}

/**
 * Close the task the alert was about. The alert stores the project the task
 * came from, so this resolves that project rather than searching every one —
 * two projects can hold tasks with the same short id prefix.
 */
function closeAlertTask(self, alert) {
  if (!alert.task_id) return false;
  let storagePath = null;
  try {
    storagePath = self.projects.get(alert.project_id)?.storagePath || null;
  } catch {
    storagePath = null;
  }
  if (!storagePath) return false;
  try {
    return Boolean(doneTask(storagePath, alert.task_id, "mobility"));
  } catch (error) {
    self.log(`telegram[${self.channel.name}] could not close task: ${error.message}`);
    return false;
  }
}

export async function handleMobilityCallback(self, callbackQuery) {
  const parts = String(callbackQuery.data || "").split(":");
  const action = parts[2] || "";
  const alertId = parts[3] || "";
  if (alertId) return handleMobilityAlertCallback(self, callbackQuery, action, alertId);
  recordMobilityResponse(action);
  const chatId = callbackQuery.message?.chat?.id;
  let ack = "Listo.";
  let response = "";
  if (action === "later") {
    const project = self.resolveProject();
    const original = String(callbackQuery.message?.text || "recordatorio de viaje").slice(0, 500);
    const id = project?.storagePath ? recordDelivery(project.storagePath, {
      agent: "super_agent",
      agentName: "Roby",
      routine: "mobility-reminder",
      notify: `Recordatorio pospuesto por usuario: ${original}`,
      priority: false,
      project_id: project.id,
    }) : null;
    ack = id ? "Lo guardé para próxima ronda." : "No pude guardar el recordatorio.";
    response = ack;
  } else if (action === "silence") {
    silenceMobilityToday();
    ack = "Sin avisos de viaje por hoy.";
    response = ack;
  } else if (action === "yes" || action === "no") {
    // Retired from the trip card — they asked "¿vas ahora?" and did nothing
    // with the answer. Still handled because cards carrying them are sitting
    // in the chat history on a phone, and a button that answers nothing is
    // worse than an outdated one.
    ack = action === "yes" ? "Marcado: vas ahora." : "Entendido: no vas ahora.";
  }
  await self._answerCallback({ callback_query_id: callbackQuery.id, text: ack });
  await clearKeyboard(self, callbackQuery);
  if (response && chatId) await self._send({ chat_id: chatId, text: response });
}

/** Best-effort: take the keyboard off a message whose buttons are now dead. */
async function clearKeyboard(self, callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  if (!chatId) return;
  try {
    await self._editKeyboard({
      chat_id: chatId,
      message_id: callbackQuery.message?.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* best-effort */ }
}

/**
 * "Was that worth interrupting you for?" — the feedback loop on proactive
 * pushes (core/nudge). One tap, no reply, and the keyboard disappears so the
 * chat does not accumulate stale buttons. Never re-enters the super-agent: an
 * opinion about a message is not a new turn to answer.
 */
export async function handleNudgeCallback(self, callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const result = applyNudgeCallback(callbackQuery.data || "");
  await self._answerCallback({
    callback_query_id: callbackQuery.id,
    text: result?.ack || "",
  });
  if (!result || !chatId) return;
  try {
    await self._editKeyboard({
      chat_id: chatId,
      message_id: callbackQuery.message?.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* best-effort */ }
  self.log(
    `telegram[${self.channel.name}] nudge feedback: ${result.entry?.kind || "?"} → ` +
    `${result.entry?.feedback?.useful ? "useful" : "noise"}`
  );
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
  if (!result) {
    // The flow is gone: ask state is process-local (see ask.js), so a daemon
    // restart or the 30-min TTL kills it while its keyboard stays in the chat
    // looking live. Acking silently is what makes the button read as broken —
    // the tap "does nothing" and the user keeps tapping. Say so, and take the
    // dead keyboard away so the message stops offering a choice it can't take.
    await self._answerCallback({
      callback_query_id: callbackQuery.id,
      text: "Esa consulta ya expiró — escribime de nuevo y la retomamos.",
    });
    self.log(`telegram[${self.channel.name}] stale ask callback: ${callbackQuery.data}`);
    await clearKeyboard(self, callbackQuery);
    return;
  }
  // Ack the press — keeps the spinner from hanging client-side.
  await self._answerCallback({ callback_query_id: callbackQuery.id });

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
  let saModel = null;
  let saTrace = null;
  try {
    const sa = await runTelegramSuperAgent(self, {
      chat_id,
      prompt: compiled,
      previousMessages,
      target,
      author,
      authorId,
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
    saModel = sa.model || state.model || null;
    saTrace = sa.trace || null;
  } catch (e) {
    self.log(`telegram[${self.channel.name}] ask resume failed: ${e.message}`);
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
    extraMeta: { ask_resume: true },
  });
}
