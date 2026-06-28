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

// This poller is intentionally thin: per-update logic lives in core/channels/
// telegram/ — dispatch (inbound routing), reply (the super-agent turn),
// ask-callbacks (the ask_questions flow), inbound/ (media), and the raw Bot API
// in api.js + media.js. The poller keeps only what the *running process* needs:
// lifecycle, the poll loop, offset state, and the thin I/O surface (self._send
// etc.) that the extracted core logic calls back into through `self`.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  loadState,
  saveState,
  resolveBotToken,
  resolveChatId,
  tokenSource,
  resolveChannels,
  sleep,
} from "#core/channels/telegram/helpers.js";
import { handleUpdate } from "#core/channels/telegram/dispatch.js";
import { handleCallbackQuery, startAskFlow, maybeConsumeAskTextAnswer } from "#core/channels/telegram/ask-callbacks.js";
import { sendMessage, sendChatAction, editMessageReplyMarkup, answerCallbackQuery, getUpdates } from "#core/channels/telegram/api.js";
import { sendPhoto, sendVoice, sendDocument, sendAudio } from "#core/channels/telegram/media.js";
export { sendPhoto, sendVoice, sendDocument, sendAudio };

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
    return getUpdates(resolveBotToken(this.channel), { offset: this.offset });
  }

  // Method body lives in ./dispatch.js as `handleUpdate(self, u)` so this file
  // stays focused on poller lifecycle. The function reaches every internal
  // poller field through the `self` it receives.
  async _handleUpdate(u) {
    return handleUpdate(this, u);
  }

  // ── ask_questions flow ──────────────────────────────────────────────────
  // Orchestration lives in ./ask-callbacks.js (state machine in ./ask.js). These
  // are thin delegates: dispatch.js reaches _startAskFlow / _maybeConsumeAsk...
  // through `self`, and inbound callback_query routes through _handleCallbackQuery.
  // The core functions call back into this poller's I/O surface (_send etc.).
  async _handleCallbackQuery(callbackQuery) {
    return handleCallbackQuery(this, callbackQuery);
  }

  async _startAskFlow(ctx) {
    return startAskFlow(this, ctx);
  }

  async _maybeConsumeAskTextAnswer(args) {
    return maybeConsumeAskTextAnswer(this, args);
  }

  // Resolve the bot token + outbound chat for this channel — the single place
  // the "no token / no chat" guards live, shared by every send method.
  _resolve(chat_id) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    if (!target) throw new Error(`channel ${this.channel.name}: no chat_id`);
    return { token, target };
  }

  // Show "typing..." indicator. Telegram clears it after ~5s; _startTyping
  // re-pings every 4s. Best-effort — failures aren't worth surfacing.
  async _typing(chat_id) {
    const token = resolveBotToken(this.channel);
    if (!token || !chat_id) return;
    try { await sendChatAction(token, chat_id); } catch { /* best-effort */ }
  }

  // Returns a stop() fn; pings the typing indicator every 4s until called.
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
    const { token, target } = this._resolve(chat_id);
    return sendMessage(token, target, { text, reply_markup, parse_mode });
  }

  // Replace/clear the inline keyboard on a sent message. Best-effort: logged.
  async _editKeyboard({ chat_id, message_id, reply_markup }) {
    const token = resolveBotToken(this.channel);
    if (!token) return;
    try {
      await editMessageReplyMarkup(token, chat_id, message_id, reply_markup);
    } catch (e) {
      this.log(`telegram[${this.channel.name}] editMessageReplyMarkup failed: ${e.message}`);
    }
  }

  // Ack a callback button press so the client clears the spinner (+ optional toast).
  async _answerCallback({ callback_query_id, text }) {
    const token = resolveBotToken(this.channel);
    if (!token) return;
    try {
      await answerCallbackQuery(token, callback_query_id, text);
    } catch (e) {
      this.log(`telegram[${this.channel.name}] answerCallbackQuery failed: ${e.message}`);
    }
  }

  /** Send a photo via this channel */
  async _sendPhoto({ chat_id, photo, caption, parse_mode }) {
    const { token, target } = this._resolve(chat_id);
    return sendPhoto(token, target, photo, { caption, parse_mode });
  }

  /** Send a voice message via this channel */
  async _sendVoice({ chat_id, audio, caption, duration }) {
    const { token, target } = this._resolve(chat_id);
    return sendVoice(token, target, audio, { caption, duration });
  }

  /** Send a document (PDF, zip, etc) via this channel */
  async _sendDocument({ chat_id, document, caption, filename, mime_type }) {
    const { token, target } = this._resolve(chat_id);
    return sendDocument(token, target, document, { caption, filename, mime_type });
  }

  /** Send an audio file via this channel */
  async _sendAudio({ chat_id, audio, caption, title, performer }) {
    const { token, target } = this._resolve(chat_id);
    return sendAudio(token, target, audio, { caption, title, performer });
  }
}

// ---------- plugin export ---------------------------------------------------

// Pick the poller to send through: the named channel if given, else the first
// channel with a usable bot token. Shared by every outbound helper below.
function pickPoller(pollers, channelName) {
  const p =
    (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
    pollers.find((pp) => resolveBotToken(pp.channel)) ||
    null;
  if (!p) throw new Error("no telegram channel available");
  return p;
}

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
        const p = pickPoller(pollers, channelName);
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
        const p = pickPoller(pollers, channelName);
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
        const p = pickPoller(pollers, channelName);
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
        const p = pickPoller(pollers, channelName);
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
        const p = pickPoller(pollers, channelName);
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
