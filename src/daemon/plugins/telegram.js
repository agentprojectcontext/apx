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
import { TELEGRAM_STATE_PATH, APX_HOME } from "../../core/config.js";
import { callEngine } from "../engines/index.js";
import { runSuperAgent, isSuperAgentEnabled } from "../super-agent.js";
import { stripThinking } from "../thinking.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "../../core/messages-store.js";
import { readAgents } from "../../core/parser.js";
import { buildAgentSystem } from "../../core/agent-system.js";
import { transcribe as transcribeAudioFile } from "../transcription.js";

const API_BASE = "https://api.telegram.org";
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// ---------- media sending helpers -------------------------------------------

/**
 * Send a photo to a Telegram chat.
 * @param {string} token     Bot token
 * @param {string|number} chatId  Telegram chat_id
 * @param {string|Buffer} photo   Absolute file path OR Buffer of image data
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.parse_mode]  "HTML" | "Markdown" | "MarkdownV2"
 */
export async function sendPhoto(token, chatId, photo, { caption, parse_mode } = {}) {
  const url = `${API_BASE}/bot${token}/sendPhoto`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (parse_mode) form.append("parse_mode", parse_mode);

  if (typeof photo === "string" && photo.startsWith("http")) {
    // Public URL — send as string
    form.append("photo", photo);
  } else {
    // Local file path or Buffer
    const buf = Buffer.isBuffer(photo) ? photo : fs.readFileSync(photo);
    const name = typeof photo === "string" ? path.basename(photo) : "photo.jpg";
    const blob = new Blob([buf], { type: name.endsWith(".png") ? "image/png" : "image/jpeg" });
    form.append("photo", blob, name);
  }

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendPhoto failed: ${json.description || res.status}`);
  return json.result;
}

/**
 * Send a voice message (OGG/Opus preferred by Telegram).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} audio  Path or Buffer
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {number} [opts.duration]
 */
export async function sendVoice(token, chatId, audio, { caption, duration } = {}) {
  const url = `${API_BASE}/bot${token}/sendVoice`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (duration) form.append("duration", String(duration));

  const buf = Buffer.isBuffer(audio) ? audio : fs.readFileSync(audio);
  const name = typeof audio === "string" ? path.basename(audio) : "voice.ogg";
  const blob = new Blob([buf], { type: "audio/ogg" });
  form.append("voice", blob, name);

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendVoice failed: ${json.description || res.status}`);
  return json.result;
}

/**
 * Send an audio file (MP3, M4A, etc — shown in Telegram music player).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} audio  Path or Buffer
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.title]
 * @param {string} [opts.performer]
 */
/**
 * Send any file as a Telegram document (PDF, zip, txt, etc).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} document  Path or Buffer of document data
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.filename] override filename for Buffer input
 * @param {string} [opts.mime_type]
 */
export async function sendDocument(token, chatId, document, { caption, filename, mime_type } = {}) {
  const url = `${API_BASE}/bot${token}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);

  // URL string → let Telegram fetch it
  if (typeof document === "string" && /^https?:\/\//.test(document)) {
    form.append("document", document);
  } else {
    const buf = Buffer.isBuffer(document) ? document : fs.readFileSync(document);
    const name =
      filename ||
      (typeof document === "string" ? path.basename(document) : "document.bin");
    const blob = new Blob([buf], { type: mime_type || "application/octet-stream" });
    form.append("document", blob, name);
  }

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendDocument failed: ${json.description || res.status}`);
  return json.result;
}

export async function sendAudio(token, chatId, audio, { caption, title, performer } = {}) {
  const url = `${API_BASE}/bot${token}/sendAudio`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (title) form.append("title", title);
  if (performer) form.append("performer", performer);

  const buf = Buffer.isBuffer(audio) ? audio : fs.readFileSync(audio);
  const name = typeof audio === "string" ? path.basename(audio) : "audio.mp3";
  const blob = new Blob([buf], { type: "audio/mpeg" });
  form.append("audio", blob, name);

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendAudio failed: ${json.description || res.status}`);
  return json.result;
}

// Audio transcription is delegated to the central dispatcher
// (../transcription.js) which handles local (faster-whisper via Python) +
// OpenAI cloud fallback. See that module for config keys.

/**
 * Download a file from Telegram servers.
 * Returns the local file path where it was saved.
 */
async function downloadTelegramFile(token, fileId, destDir) {
  // Step 1: get file path from Telegram
  const infoRes = await fetch(`${API_BASE}/bot${token}/getFile?file_id=${fileId}`);
  const infoJson = await infoRes.json();
  if (!infoJson.ok) throw new Error(`getFile failed: ${infoJson.description}`);
  const filePath = infoJson.result.file_path; // e.g. "photos/file_123.jpg"
  const ext = path.extname(filePath) || ".jpg";
  const fileName = `tg_${fileId.slice(-8)}_${Date.now()}${ext}`;
  const localPath = path.join(destDir, fileName);

  // Step 2: download
  const dlRes = await fetch(`${API_BASE}/file/bot${token}/${filePath}`);
  if (!dlRes.ok) throw new Error(`download failed: ${dlRes.status}`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  return localPath;
}

// ---------- shared state ----------------------------------------------------

function loadState() {
  if (!fs.existsSync(TELEGRAM_STATE_PATH)) return { channels: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(TELEGRAM_STATE_PATH, "utf8"));
    return { channels: raw.channels || {}, _legacy_offset: raw.offset || 0 };
  } catch {
    return { channels: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(
    TELEGRAM_STATE_PATH,
    JSON.stringify({ ...state, updated_at: nowIso() }, null, 2) + "\n"
  );
}

// ---------- env-fallback helpers --------------------------------------------

function resolveBotToken(channel) {
  return (
    channel.bot_token ||
    process.env.BOT_TELEGRAM_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
  );
}

function resolveChatId(channel) {
  return (
    channel.chat_id ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.BOT_TELEGRAM_CHAT_ID ||
    ""
  );
}

function tokenSource(channel) {
  if (channel.bot_token) return "config";
  if (process.env.BOT_TELEGRAM_TOKEN) return "env:BOT_TELEGRAM_TOKEN";
  if (process.env.TELEGRAM_BOT_TOKEN) return "env:TELEGRAM_BOT_TOKEN";
  return null;
}

// ---------- channel-list resolution -----------------------------------------

function resolveChannels(globalConfig) {
  const tg = globalConfig.telegram || {};
  if (Array.isArray(tg.channels) && tg.channels.length > 0) {
    return tg.channels.map((c, i) => ({
      name: c.name || `channel-${i + 1}`,
      bot_token: c.bot_token || "",
      chat_id: c.chat_id || "",
      route_to_agent: c.route_to_agent || "",
      project: c.project || null,
      respond_with_engine:
        c.respond_with_engine !== undefined
          ? c.respond_with_engine
          : tg.respond_with_engine !== false,
      poll_interval_ms: c.poll_interval_ms || tg.poll_interval_ms || 1500,
    }));
  }
  // Legacy single-channel mode
  if (!tg.bot_token && !process.env.BOT_TELEGRAM_TOKEN && !process.env.TELEGRAM_BOT_TOKEN) {
    return [];
  }
  return [
    {
      name: "default",
      bot_token: tg.bot_token || "",
      chat_id: tg.chat_id || "",
      route_to_agent: tg.route_to_agent || "",
      project: null,
      respond_with_engine: tg.respond_with_engine !== false,
      poll_interval_ms: tg.poll_interval_ms || 1500,
    },
  ];
}

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

  async _handleUpdate(u) {
    this.lastUpdateAt = nowIso();
    const msg = u.message || u.edited_message;
    if (!msg) return;
    const target = this.resolveProject();
    if (!target) {
      this.log(`telegram[${this.channel.name}] update ${u.update_id} ignored — no target project`);
      return;
    }
    const author =
      msg.from?.username
        ? "@" + msg.from.username
        : `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "unknown";
    const chat_id = msg.chat?.id;
    let text = msg.text || msg.caption || "";

    // ── Incoming photo handling ───────────────────────────────────────────
    if (msg.photo && msg.photo.length > 0) {
      // Telegram sends multiple sizes; pick the largest
      const bestPhoto = msg.photo.reduce((a, b) => (b.file_size > a.file_size ? b : a));
      const token = resolveBotToken(this.channel);
      const mediaDir = path.join(APX_HOME, "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      try {
        const localPath = await downloadTelegramFile(token, bestPhoto.file_id, mediaDir);
        this.log(`telegram[${this.channel.name}] photo saved: ${localPath}`);
        appendGlobalMessage({
          channel: "telegram",
          direction: "in",
          type: "photo",
          actor_id: msg.from?.id ? String(msg.from.id) : author,
          external_id: String(u.update_id),
          author,
          body: text || "[photo]",
          meta: {
            chat_id,
            user_id: msg.from?.id || null,
            message_id: msg.message_id,
            tg_channel: this.channel.name,
            local_path: localPath,
            file_id: bestPhoto.file_id,
            width: bestPhoto.width,
            height: bestPhoto.height,
          },
        });
      } catch (e) {
        this.log(`telegram[${this.channel.name}] photo download failed: ${e.message}`);
      }
      // If there's a caption, continue to handle it as text; otherwise return
      if (!text) return;
    }

    // ── Incoming voice / audio handling ──────────────────────────────────
    // Telegram sends `voice` for the press-and-hold mic recording (.oga/opus)
    // and `audio` for uploaded audio files (mp3/m4a/etc.). Either way we
    // download, run it through Whisper, prefix the result with `[audio] `
    // and let the rest of the message flow handle it as plain text.
    const incomingAudio = msg.voice || msg.audio;
    if (incomingAudio && incomingAudio.file_id) {
      const token = resolveBotToken(this.channel);
      const mediaDir = path.join(APX_HOME, "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      let localPath = null;
      let transcript = "";
      let transcribeError = null;
      let transcribeBackend = null;
      try {
        localPath = await downloadTelegramFile(token, incomingAudio.file_id, mediaDir);
        this.log(`telegram[${this.channel.name}] audio saved: ${localPath}`);
      } catch (e) {
        this.log(`telegram[${this.channel.name}] audio download failed: ${e.message}`);
      }
      if (localPath) {
        try {
          const result = await transcribeAudioFile(localPath);
          transcript = result.text || "";
          transcribeBackend = result.backend;
          this.log(`telegram[${this.channel.name}] audio transcribed via ${transcribeBackend} (${transcript.length} chars, lang=${result.language || "?"})`);
        } catch (e) {
          transcribeError = e.message;
          this.log(`telegram[${this.channel.name}] audio transcription failed: ${e.message}`);
        }
      }
      const audioBody = transcript
        ? `[audio] ${transcript}`
        : `[audio] (transcription unavailable${transcribeError ? ": " + transcribeError : ""})`;

      appendGlobalMessage({
        channel: "telegram",
        direction: "in",
        type: "audio",
        actor_id: msg.from?.id ? String(msg.from.id) : author,
        external_id: String(u.update_id),
        author,
        body: audioBody,
        meta: {
          chat_id,
          user_id: msg.from?.id || null,
          message_id: msg.message_id,
          tg_channel: this.channel.name,
          local_path: localPath,
          file_id: incomingAudio.file_id,
          duration: incomingAudio.duration,
          mime_type: incomingAudio.mime_type,
          transcription_backend: transcribeBackend,
          transcription_error: transcribeError,
        },
      });

      // Inject the transcribed text into `text` so the rest of the agent
      // pipeline treats it identically to a typed message. If there was a
      // caption alongside the audio, prepend the audio marker to it.
      text = text ? `${audioBody}\n${text}` : audioBody;
    }

    // /reset or /new wipes the rolling context for this chat. We just
    // remember a marker timestamp; subsequent inbounds will only consider
    // history newer than this. Implemented by writing a synthetic message
    // with a known marker so getRecentTelegramTurns naturally cuts off.
    const isReset = /^\/(reset|new)\b/i.test(text.trim());

    // Pull the prior conversation BEFORE we log this inbound — so the
    // current message isn't part of its own history. We then prune anything
    // older than the most recent /reset for this chat_id.
    let previousMessages = [];
    if (chat_id && !isReset) {
      previousMessages = getRecentTelegramTurnsFromFs({
        chat_id,
        limit: 20,
        max_age_hours: 24,
      });
      // Honour a /reset marker: drop everything up to and including it.
      const lastResetIdx = (() => {
        for (let i = previousMessages.length - 1; i >= 0; i--) {
          if (
            previousMessages[i].role === "user" &&
            /^\/(reset|new)\b/i.test(previousMessages[i].content.trim())
          ) {
            return i;
          }
        }
        return -1;
      })();
      if (lastResetIdx >= 0) {
        previousMessages = previousMessages.slice(lastResetIdx + 1);
      }
    }

    // Always log inbound to global store (~/.apx/messages/telegram/)
    appendGlobalMessage({
      channel: "telegram",
      direction: "in",
      type: "user",
      actor_id: msg.from?.id ? String(msg.from.id) : author,
      external_id: String(u.update_id),
      author,
      body: text,
      meta: {
        chat_id,
        user_id: msg.from?.id || null,
        message_id: msg.message_id,
        tg_channel: this.channel.name,
      },
    });

    if (!this.channel.respond_with_engine) return;
    if (!text) return;

    // Short-circuit /reset / /new: send an ack and don't engage the engine.
    // The marker we just logged is enough — getRecentTelegramTurns will
    // honor it for future messages.
    if (isReset) {
      try {
        const ack = "Done, context cleared. Starting fresh. What do you need?";
        await this._send({ chat_id, text: ack });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "agent",
          actor_id: "apx",
          author: "apx",
          body: ack,
          meta: { chat_id, tg_channel: this.channel.name, in_reply_to: u.update_id, reset: true },
        });
      } catch (e) {
        this.log(`telegram[${this.channel.name}] reset ack failed: ${e.message}`);
      }
      return;
    }

    // Start "typing..." indicator. Stops when we send the reply (or fail).
    const stopTyping = this._startTyping(chat_id);

    let replyText;
    let replyAuthor;
    const projectCfg = target.config || this.globalConfig;

    // Try the project's chosen agent first
    const routeSlug = this.channel.route_to_agent;
    if (routeSlug) {
      const agent = readAgents(target.path).find((a) => a.slug === routeSlug);
      if (agent && agent.fields.Model) {
        try {
          const system = buildAgentSystem(target, agent, {
            invocation: "telegram",
            channel: this.channel.name,
            caller: author,
          });
          const result = await callEngine({
            modelId: agent.fields.Model,
            system,
            messages: [{ role: "user", content: text }],
            config: projectCfg,
          });
          replyText = result.text;
          replyAuthor = agent.slug;
        } catch (e) {
          this.log(`telegram[${this.channel.name}] agent reply failed: ${e.message}`);
          replyText = `[apx error] ${e.message.slice(0, 200)}`;
          replyAuthor = "apx";
        }
      } else {
        this.log(
          `telegram[${this.channel.name}] route_to_agent="${routeSlug}" not usable (missing or no model) → trying super-agent`
        );
      }
    }

    // Fallback: super-agent
    let saTrace = null;
    let saUsage = null;
    if (!replyText && isSuperAgentEnabled(this.globalConfig)) {
      try {
        const sa = await runSuperAgent({
          globalConfig: this.globalConfig,
          projects: this.projects,
          plugins: this.plugins,
          registries: this.registries,
          prompt: text,
          previousMessages,
          contextNote: `You are replying inside Telegram right now. Telegram channel="${this.channel.name}", author=${author}, chat_id=${chat_id}. Keep the reply plain-text and concise. Previous turns of this chat are included only for local conversational context; re-call tools for facts.`,
        });
        replyText = sa.text;
        replyAuthor = sa.name;
        saTrace = sa.trace;
        saUsage = sa.usage;
      } catch (e) {
        this.log(`telegram[${this.channel.name}] super-agent failed: ${e.message}`);
      }
    }

    if (!replyText) {
      stopTyping();
      return;
    }

    // Strip <thinking>...</thinking> blocks before sending to Telegram —
    // reasoning is noise to the chat reader. The full text (with thinking)
    // stays in the daemon log and in messages with channel='engine' if the
    // model produced any.
    const clean = stripThinking(replyText);

    // Send reply via this channel's bot
    stopTyping();
    try {
      await this._send({ chat_id, text: clean || replyText });
      // Log outbound — store the cleaned text (what we actually sent). The
      // full reasoning (if any) goes in meta_json so it's recoverable.
      const meta = {
        chat_id,
        tg_channel: this.channel.name,
        in_reply_to: u.update_id,
      };
      if (clean !== replyText) meta.thinking_stripped = true;
      if (saTrace && saTrace.length > 0) {
        // Compact representation: [{tool, args}] without the full result
        // (results can be huge — keep them out of the long-lived FS log).
        meta.tools_called = saTrace.map((t) => ({
          tool: t.tool,
          args: t.args,
        }));
      }
      if (saUsage) meta.usage = saUsage;
      appendGlobalMessage({
        channel: "telegram",
        direction: "out",
        type: "agent",
        actor_id: replyAuthor || "apx",
        agent_slug: replyAuthor || "apx",
        author: replyAuthor || "apx",
        body: clean || replyText,
        meta,
      });
    } catch (e) {
      this.log(`telegram[${this.channel.name}] send-back error: ${e.message}`);
      appendGlobalMessage({
        channel: "telegram",
        direction: "out",
        type: "agent",
        actor_id: replyAuthor || "apx",
        agent_slug: replyAuthor || "apx",
        author: replyAuthor || "apx",
        body: `[send_failed] ${clean || replyText}`,
        meta: {
          chat_id,
          tg_channel: this.channel.name,
          in_reply_to: u.update_id,
          send_error: e.message,
          ...(saTrace && saTrace.length > 0
            ? { tools_called: saTrace.map((t) => ({ tool: t.tool, args: t.args })) }
            : {}),
          ...(saUsage ? { usage: saUsage } : {}),
        },
      });
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

  async _send({ chat_id, text }) {
    const token = resolveBotToken(this.channel);
    if (!token) throw new Error(`channel ${this.channel.name}: no bot_token`);
    const target = chat_id || resolveChatId(this.channel);
    if (!target) throw new Error(`channel ${this.channel.name}: no chat_id`);
    const url = `${API_BASE}/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: target, text }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || `send failed (${res.status})`);
    return json.result;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      async send({ channel: channelName, chat_id, text, author = "apx", project }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._send({ chat_id, text });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "agent",
          actor_id: author,
          agent_slug: author,
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
      async sendPhoto({ channel: channelName, chat_id, photo, caption, parse_mode, author = "apx" }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendPhoto({ chat_id, photo, caption, parse_mode });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "photo",
          actor_id: author,
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
      async sendVoice({ channel: channelName, chat_id, audio, caption, duration, author = "apx" }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendVoice({ chat_id, audio, caption, duration });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "voice",
          actor_id: author,
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
      async sendDocument({ channel: channelName, chat_id, document, caption, filename, mime_type, author = "apx" }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendDocument({ chat_id, document, caption, filename, mime_type });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "document",
          actor_id: author,
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
      async sendAudio({ channel: channelName, chat_id, audio, caption, title, performer, author = "apx" }) {
        const p =
          (channelName && pollers.find((pp) => pp.channel.name === channelName)) ||
          pollers.find((pp) => resolveBotToken(pp.channel)) ||
          null;
        if (!p) throw new Error("no telegram channel available");
        const result = await p._sendAudio({ chat_id, audio, caption, title, performer });
        appendGlobalMessage({
          channel: "telegram",
          direction: "out",
          type: "audio",
          actor_id: author,
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
