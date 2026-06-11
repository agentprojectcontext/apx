// Telegram plugin (multi-channel).
//
// Each "channel" is a Telegram bot that polls independently and routes inbound
// to a specific project + agent. Multiple channels in one daemon = multiple
// bots, each with its own persona, all sharing the same APC runtime.
//
// Config shape (in ~/.apx/config.json or .apc/config.json):
//
//   "telegram": {
//     "enabled": true,
//     "respond_with_engine": true,         // default for all channels
//     "channels": [
//       {
//         "name": "support",
//         "bot_token": "...",
//         "chat_id":   "1234",             // default outbound chat
//         "route_to_agent": "sofia",       // who replies; "" → super-agent fallback
//         "project": "/path/to/proj",      // optional; defaults to first registered
//         "respond_with_engine": true      // override for this channel
//       },
//       ...
//     ],
//     // legacy single-channel keys (used only when channels[] is absent/empty):
//     "bot_token": "",
//     "chat_id": "",
//     "route_to_agent": "",
//     "poll_interval_ms": 1500
//   }

import fs from "node:fs";
import path from "node:path";
import { TELEGRAM_STATE_PATH, APX_HOME } from "#core/config/index.js";
import { callEngine } from "#core/engines/index.js";
import { runSuperAgent, isSuperAgentEnabled } from "#core/agent/super-agent.js";
import { stripThinking } from "../../thinking.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "#core/stores/messages.js";
import { compactChannelIfNeeded } from "#core/memory/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { transcribe as transcribeAudioFile } from "../../transcription.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { registerSender, resolveAllowedTools } from "#core/identity/telegram.js";
import { buildRelationshipBlock } from "#core/agent/index.js";
import { getConfirmationStore as getConfirmStore } from "#core/confirmation/pending-store.js";
import { CHANNELS } from "#core/constants/channels.js";
import { tryResolveSkillCommand } from "#core/agent/skills/trigger.js";
import { createTelegramConfirmAdapter } from "#core/confirmation/adapters/telegram.js";
import * as askFlow from "./ask.js";

// API_BASE re-imported from ./media.js below
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// All non-class-bound helpers live in ./helpers.js so the file stays
// focused on the poller class + dispatch wiring.
import {
  buildTelegramMeta,
  loadState,
  saveState,
  resolveBotToken,
  resolveChatId,
  tokenSource,
  resolveChannels,
  sleep,
} from "./helpers.js";
import { handleUpdate } from "./dispatch.js";

// ---------- media sending helpers (re-exports) ------------------------------
import { sendPhoto, sendVoice, sendDocument, sendAudio, downloadTelegramFile, API_BASE } from "./media.js";
export { sendPhoto, sendVoice, sendDocument, sendAudio };

// ---------- per-channel poller ----------------------------------------------

class ChannelPoller {
  constructor({ channel, projects, globalConfig, log, plugins, registries }) {
    this.channel = channel;
    this.projects = projects;
    this.globalConfig = globalConfig;
    this.log = log;
    this.plugins = plugins;
    this.registries = registries;
    this.state = loadState();
    this.offset =
      this.state.channels?.[channel.name]?.offset ??
      (channel.name === "default" ? this.state._legacy_offset || 0 : 0);
    this.polling = false;
    this.lastError = null;
    this.lastUpdateAt = null;
    this.activeRequests = new Map(); // chat_id -> AbortController
  }

  resolveProject() {
    if (this.channel.project) {
      const e = this.projects.getByPath(this.channel.project);
      if (e) return e;
      this.log(`telegram[${this.channel.name}]: project ${this.channel.project} not registered`);
    }
    const all = this.projects.list();
    if (all.length === 0) return null;
    return this.projects.get(all[0].id);
  }

  status() {
    return {
      name: this.channel.name,
      polling: this.polling,
      offset: this.offset,
      route_to_agent: this.channel.route_to_agent || null,
      respond_with_engine: this.channel.respond_with_engine,
      project: this.channel.project || null,
      bot_token_present: !!resolveBotToken(this.channel),
      bot_token_source: tokenSource(this.channel),
      chat_id: resolveChatId(this.channel) || null,
      last_error: this.lastError,
      last_update_at: this.lastUpdateAt,
    };
  }

  start() {
    if (this.polling) return;
    if (!resolveBotToken(this.channel)) {
      this.log(`telegram[${this.channel.name}]: no bot_token (config or env) — not starting`);
      return;
    }
    this.polling = true;
    this._loop().catch((e) => {
      this.lastError = e.message;
      this.polling = false;
      this.log(`telegram[${this.channel.name}] loop crashed: ${e.message}`);
    });
  }

  stop() {
    this.polling = false;
  }

  async _loop() {
    const interval = this.channel.poll_interval_ms;
    let backoff = 1000;
    while (this.polling) {
      try {
        const updates = await this._getUpdates();
        // A successful poll clears any stale error so status reflects recovery.
        this.lastError = null;
        for (const u of updates) {
          await this._handleUpdate(u);
          this.offset = u.update_id + 1;
          this._saveOffset();
        }
        backoff = 1000;
        if (updates.length === 0) await sleep(interval);
      } catch (e) {
        this.lastError = e.message;
        this.log(`telegram[${this.channel.name}] error: ${e.message}; backing off ${backoff}ms`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  _saveOffset() {
    const s = loadState();
    s.channels = s.channels || {};
    s.channels[this.channel.name] = { offset: this.offset, updated_at: nowIso() };
    saveState(s);
  }

  async _getUpdates() {
    const token = resolveBotToken(this.channel);
    const url = `${API_BASE}/bot${token}/getUpdates?timeout=25&offset=${this.offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getUpdates ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "telegram error");
    return json.result || [];
  }

  // Method body lives in ./dispatch.js as `handleUpdate(self, u)` so this file
  // stays focused on poller lifecycle. The function reaches every internal
  // poller field through the `self` it receives.
  async _handleUpdate(u) {
    return handleUpdate(this, u);
  }

  async _handleCallbackQuery(callbackQuery) {
    // Route ask_questions button presses before the confirmation adapter —
    // both use `apx:<verb>:...` namespacing but ask owns its own state.
    const data = callbackQuery.data || "";
    if (data.startsWith("apx:ask:")) {
      await this._handleAskCallback(callbackQuery);
      return;
    }

    const adapter = createTelegramConfirmAdapter({
      token: resolveBotToken(this.channel),
      chatId: callbackQuery.message?.chat?.id,
      pendingStore: getConfirmStore(),
    });
    const handled = await adapter.handleCallbackQuery(callbackQuery);
    if (!handled) {
      this.log(`telegram[${this.channel.name}] unhandled callback_query: ${callbackQuery.data}`);
    }
  }

  // ── ask_questions: state-machine helpers ───────────────────────────────
  // The flow lives in telegram-ask.js; this class owns the I/O (sending
  // messages, editing keyboards, re-entering the super-agent loop with the
  // compiled answer once the flow finishes).

  async _renderQuestion(state) {
    const text = askFlow.formatQuestionText(state);
    const reply_markup = askFlow.buildKeyboard(state);
    // If we already have a message for the previous question, leave its
    // keyboard wiped — we draw a fresh message per question for clearer
    // history in the chat (the question text stays as a record).
    if (state.messageId) {
      try {
        await this._editKeyboard({
          chat_id: state.chatId,
          message_id: state.messageId,
          reply_markup: { inline_keyboard: [] },
        });
      } catch { /* best-effort */ }
    }
    const sent = await this._send({
      chat_id: state.chatId,
      text,
      reply_markup,
      parse_mode: "Markdown",
    });
    state.messageId = sent?.message_id || null;
    askFlow.saveState(state.chatId, state);
  }

  // Kick off a brand-new ask flow after the super-agent called ask_questions.
  // The flow's `resume` callback captures the per-turn context (sender,
  // relationship, project) so when the compiled answer arrives we can run
  // another super-agent turn without retyping all the inputs.
  async _startAskFlow(ctx) {
    const state = askFlow.startFlow({
      chatId: ctx.chat_id,
      projectId: ctx.projectId,
      authorId: ctx.authorId,
      questions: ctx.questions,
      resume: async (compiled) => {
        await this._runResumedTurn({ ...ctx, compiled });
      },
    });
    await this._renderQuestion(state);
  }

  // Apply an inline-keyboard press, then react: redraw, advance, or finish.
  async _handleAskCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    if (!chatId) return;
    const result = askFlow.applyCallback(chatId, callbackQuery.data || "");
    // Ack the press regardless — keeps the spinner from hanging client-side.
    await this._answerCallback({ callback_query_id: callbackQuery.id });
    if (!result) return; // stale or unknown — adapter already ack'd.

    if (result.action === "redraw") {
      // Multi-select toggle: just refresh the keyboard on the SAME message.
      try {
        await this._editKeyboard({
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          reply_markup: askFlow.buildKeyboard(result.state),
        });
      } catch (e) {
        this.log(`telegram[${this.channel.name}] redraw failed: ${e.message}`);
      }
      return;
    }
    if (result.action === "advance") {
      await this._renderQuestion(result.state);
      return;
    }
    if (result.action === "cancel") {
      try {
        await this._editKeyboard({
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          reply_markup: { inline_keyboard: [] },
        });
        await this._send({ chat_id: chatId, text: "Pregunta cancelada." });
      } catch { /* best-effort */ }
      return;
    }
    if (result.action === "done") {
      try {
        await this._editKeyboard({
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

  // Apply a free-text user reply when there's a pending free-text question.
  // Returns true iff the message was consumed by the ask flow (so the normal
  // super-agent path should be skipped for this update).
  async _maybeConsumeAskTextAnswer({ chat_id, text }) {
    if (!chat_id || !text) return false;
    if (!askFlow.hasPendingFreeText(chat_id)) return false;
    const state = askFlow.applyTextAnswer(chat_id, text);
    if (!state) return false;
    // Advance: emit a synthetic "next" to move past this question.
    const next = askFlow.applyCallback(
      chat_id,
      `apx:ask:${state.correlationId}:next`,
    );
    if (!next) return true;
    if (next.action === "advance") {
      await this._renderQuestion(next.state);
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

  // Run a follow-up super-agent turn with the compiled answers as the user
  // prompt. Mirrors the post-runSuperAgent reply path in _handleUpdate but
  // skipped of the photo/audio/reset preamble. Re-enters the ask flow if the
  // model decides to ask again.
  async _runResumedTurn(ctx) {
    const { chat_id, compiled, target, relationshipBlock, allowedTools, author, agentDisplay, update_id, sender, authorId } = ctx;
    if (!chat_id) return;
    // Log the synthetic user message so getRecentTelegramTurnsFromFs picks
    // it up on the NEXT inbound. Mirrors how a normal text reply would be
    // recorded.
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "in",
      type: "user",
      actor_id: authorId ? String(authorId) : (author || "ask_flow"),
      external_id: `ask-${Date.now()}`,
      author: author || "user",
      body: compiled,
      meta: {
        chat_id,
        user_id: authorId || null,
        tg_channel: this.channel.name,
        ask_flow: true,
      },
    });

    const previousMessages = getRecentTelegramTurnsFromFs({
      chat_id,
      keepRecent: 40,
      max_age_hours: 24,
    });

    const stopTyping = this._startTyping(chat_id);
    try {
      const sa = await runSuperAgent({
        globalConfig: this.globalConfig,
        projects: this.projects,
        plugins: this.plugins,
        registries: this.registries,
        prompt: compiled,
        previousMessages,
        channel: CHANNELS.TELEGRAM,
        relationshipBlock,
        allowedTools,
        channelMeta: { channel: CHANNELS.TELEGRAM, chat_id, author, route_to_agent: this.channel.route_to_agent },
      });
      stopTyping();

      // Did the model ask again? Restart the flow instead of replying.
      const followupAsk = askFlow.extractAskQuestionsFromTrace(sa.trace);
      if (followupAsk) {
        await this._startAskFlow({
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

      const replyText = sa.text ? stripThinking(sa.text).trim() : "";
      if (replyText) {
        await this._send({ chat_id, text: replyText });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "agent",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author: sa.name || agentDisplay,
          body: replyText,
          meta: {
            chat_id,
            tg_channel: this.channel.name,
            in_reply_to: update_id,
            final: true,
            ask_resume: true,
            ...(sa.usage ? { usage: sa.usage } : {}),
          },
        });
      }
    } catch (e) {
      stopTyping();
      this.log(`telegram[${this.channel.name}] ask resume failed: ${e.message}`);
      try {
        await this._send({ chat_id, text: `⚠️ Error procesando tus respuestas (${e.message}).` });
      } catch { /* best-effort */ }
    }
  }

  // Show "typing..." indicator in the chat. Telegram clears it automatically
  // after 5 seconds, so call this every ~4s while a long operation is going.
  async _typing(chat_id) {
    try {
      const token = resolveBotToken(this.channel);
      if (!token || !chat_id) return;
      const url = `${API_BASE}/bot${token}/sendChatAction`;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, action: "typing" }),
      });
    } catch {
      // best-effort; failures here aren't worth surfacing
    }
  }

  // Returns a function that pings sendChatAction every 4s until called as
  // stop(). Used to wrap the engine round-trip in a "typing" loop so the
  // user sees feedback while qwen thinks.
  _startTyping(chat_id) {
    if (!chat_id) return () => {};
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await this._typing(chat_id);
      if (!stopped) setTimeout(tick, 4000);
    };
    tick();
    return () => { stopped = true; };
  }

  async _send({ chat_id, text, reply_markup, parse_mode }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    if (!target) throw new Error(`channel ${this.channel.name}: no chat_id`);
    const url = `${API_BASE}/bot${token}/sendMessage`;
    const body = { chat_id: target, text };
    if (reply_markup) body.reply_markup = reply_markup;
    if (parse_mode) body.parse_mode = parse_mode;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || `send failed (${res.status})`);
    return json.result;
  }

  // Replace just the inline keyboard on a previously-sent message (used to
  // refresh after a multi-select toggle, or to wipe buttons once the flow
  // has moved on). Best-effort: failures are logged but don't break the flow.
  async _editKeyboard({ chat_id, message_id, reply_markup }) {
    const token = resolveBotToken(this.channel);
    if (!token) return;
    try {
      const url = `${API_BASE}/bot${token}/editMessageReplyMarkup`;
      const body = { chat_id, message_id };
      if (reply_markup) body.reply_markup = reply_markup;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.log(`telegram[${this.channel.name}] editMessageReplyMarkup failed: ${e.message}`);
    }
  }

  // Acknowledge a callback button press so the user's Telegram client clears
  // the spinner on the tapped button. Optional `text` shows a small toast.
  async _answerCallback({ callback_query_id, text }) {
    const token = resolveBotToken(this.channel);
    if (!token) return;
    try {
      const url = `${API_BASE}/bot${token}/answerCallbackQuery`;
      const body = { callback_query_id };
      if (text) body.text = text;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.log(`telegram[${this.channel.name}] answerCallbackQuery failed: ${e.message}`);
    }
  }

  /** Send a photo via this channel */
  async _sendPhoto({ chat_id, photo, caption, parse_mode }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    if (!target) throw new Error(`channel ${this.channel.name}: no chat_id`);
    return sendPhoto(token, target, photo, { caption, parse_mode });
  }

  /** Send a voice message via this channel */
  async _sendVoice({ chat_id, audio, caption, duration }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    return sendVoice(token, target, audio, { caption, duration });
  }

  /** Send a document (PDF, zip, etc) via this channel */
  async _sendDocument({ chat_id, document, caption, filename, mime_type }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    return sendDocument(token, target, document, { caption, filename, mime_type });
  }

  /** Send an audio file via this channel */
  async _sendAudio({ chat_id, audio, caption, title, performer }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    return sendAudio(token, target, audio, { caption, title, performer });
  }
}

// ---------- plugin export ---------------------------------------------------

export default {
  id: "telegram",

  init({ projects, config, log, plugins, registries }) {
    const channels = resolveChannels(config);
    const pollers = channels.map(
      (channel) =>
        new ChannelPoller({
          channel,
          projects,
          globalConfig: config,
          log,
          plugins,
          registries,
        })
    );

    return {
      start() {
        if (!config.telegram?.enabled) {
          log("telegram disabled in config — not starting any channel");
          return;
        }
        for (const p of pollers) p.start();
      },
      stop() {
        for (const p of pollers) p.stop();
      },
      status() {
        return {
          enabled: !!config.telegram?.enabled,
          channels: pollers.map((p) => p.status()),
        };
      },
      // Direct send used by the API and by routines. If `channel` given, use
      // that bot; otherwise first available bot-tokened channel. Always logs
      // the outbound on `messages` of the channel's target project so audit
      // trails are complete.
      async send({ channel: channelName, chat_id, text, author = resolveAgentName(config), project }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._send({ chat_id, text });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "agent",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author,
          body: text,
          meta: {
            chat_id: chat_id || resolveChatId(p.channel),
            tg_channel: p.channel.name,
            via: channelName ? "explicit" : "auto",
          },
        });
        return result;
      },

      /**
       * Send a photo to a Telegram chat.
       * photo: local file path, Buffer, or public URL
       * opts: { caption, parse_mode, channel, author }
       */
      async sendPhoto({ channel: channelName, chat_id, photo, caption, parse_mode, author = resolveAgentName(config) }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendPhoto({ chat_id, photo, caption, parse_mode });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "photo",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          author,
          body: caption || "[photo]",
          meta: { chat_id: chat_id || resolveChatId(p.channel), tg_channel: p.channel.name },
        });
        return result;
      },

      /**
       * Send a voice message (OGG/Opus preferred).
       * audio: local file path or Buffer
       */
      async sendVoice({ channel: channelName, chat_id, audio, caption, duration, author = resolveAgentName(config) }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendVoice({ chat_id, audio, caption, duration });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "voice",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          author,
          body: caption || "[voice]",
          meta: { chat_id: chat_id || resolveChatId(p.channel), tg_channel: p.channel.name },
        });
        return result;
      },

      /**
       * Send a document (PDF, zip, txt, generated reports, etc).
       * document: local file path, Buffer, or public https URL.
       */
      async sendDocument({ channel: channelName, chat_id, document, caption, filename, mime_type, author = resolveAgentName(config) }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendDocument({ chat_id, document, caption, filename, mime_type });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "document",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          author,
          body: caption || `[document${filename ? " " + filename : ""}]`,
          meta: { chat_id: chat_id || resolveChatId(p.channel), tg_channel: p.channel.name, filename, mime_type },
        });
        return result;
      },

      /**
       * Send an audio file (MP3/M4A — shown in music player).
       * audio: local file path or Buffer
       */
      async sendAudio({ channel: channelName, chat_id, audio, caption, title, performer, author = resolveAgentName(config) }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendAudio({ chat_id, audio, caption, title, performer });
        appendGlobalMessage({
          channel: CHANNELS.TELEGRAM,
          direction: "out",
          type: "audio",
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          author,
          body: caption || title || "[audio]",
          meta: { chat_id: chat_id || resolveChatId(p.channel), tg_channel: p.channel.name },
        });
        return result;
      },

      pollers,
    };
  },
};
