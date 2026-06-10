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
import { TELEGRAM_STATE_PATH, APX_HOME } from "../../../core/config.js";
import { callEngine } from "../../../core/engines/index.js";
import { runSuperAgent, isSuperAgentEnabled } from "../super-agent.js";
import { stripThinking } from "../thinking.js";
import { getRecentTelegramTurnsFromFs, appendGlobalMessage } from "../../../core/messages-store.js";
import { compactChannelIfNeeded } from "../../../core/memory/index.js";
import { readAgents } from "../../../core/parser.js";
import { buildAgentSystem } from "../../../core/agent/build-agent-system.js";
import { transcribe as transcribeAudioFile } from "../transcription.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "../../../core/identity/index.js";
import { registerSender, resolveAllowedTools } from "../../../core/identity/telegram.js";
import { buildRelationshipBlock } from "../../../core/agent/index.js";
import { getConfirmationStore as getConfirmStore } from "../../../core/confirmation/pending-store.js";
import { createTelegramConfirmAdapter } from "../../../core/confirmation/adapters/telegram.js";
import * as askFlow from "./telegram-ask.js";

const API_BASE = "https://api.telegram.org";
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Build the channelMeta passed to the super-agent loop. The prompt template at
// src/core/agent/prompts/channels/telegram.md interpolates {{projectBlock}}
// and {{routeBlock}} verbatim, so we pre-render them as plain text here
// (the template engine doesn't do conditionals).
function buildTelegramMeta({ channelName, author, chatId, target, routeToAgent }) {
  const projectBlock = target
    ? `\nProject pin: **${target.name || "(unnamed)"}** (\`${target.path || "?"}\`).\n` +
      "This Telegram channel belongs to that project. Default any " +
      "project-scoped tool call (list_agents, list_tasks, list_mcps, " +
      "list_skills, create_task, list_routines, …) to " +
      `\`${target.name || target.path}\` without asking the user "which ` +
      'project?". Only ask when they explicitly reference another project ' +
      "by name."
    : "";
  const routeBlock = routeToAgent
    ? `\nMaster agent for this channel: **${routeToAgent}**. Prefer ` +
      `delegating substantive work to that agent via call_agent({ project: ` +
      `"${target?.name || target?.path || ""}", agent: "${routeToAgent}", ` +
      "prompt: <user message> }) rather than answering yourself, unless " +
      "the message is small-talk or a quick factual reply."
    : "";
  return {
    channelName,
    author,
    chatId,
    projectBlock,
    routeBlock,
    // Also expose raw fields for any future surface / log that wants them.
    ...(target ? {
      projectId:   String(target.id),
      projectName: target.name || "",
      projectPath: target.path || "",
    } : {}),
    ...(routeToAgent ? { routeToAgent } : {}),
  };
}

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

  async _handleUpdate(u) {
    this.lastUpdateAt = nowIso();

    // Inline keyboard button press: route to the confirmation adapter.
    if (u.callback_query) {
      await this._handleCallbackQuery(u.callback_query);
      return;
    }

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

    // Resolve WHO is writing (owner / known contact / guest), keyed by the
    // stable Telegram user_id. Records unknown senders and, on a fresh private
    // channel with no owner yet, claims this sender as the owner. Mutates the
    // in-memory globalConfig in place so later messages in this daemon session
    // see the update. The resulting block is injected into whichever agent
    // answers (super-agent OR a routed project agent).
    const { sender } = registerSender({
      cfg: this.globalConfig,
      channelName: this.channel.name,
      from: msg.from,
      chatType: msg.chat?.type,
    });
    const relationshipBlock = buildRelationshipBlock(sender);
    // Role-based tool gating for the super-agent path (guests → no tools).
    const allowedTools = resolveAllowedTools(this.globalConfig, sender);

    // Default Interrupt: abort any running request for this chat_id
    if (chat_id) {
      const prev = this.activeRequests.get(chat_id);
      if (prev) {
        this.log(`telegram[${this.channel.name}] interrupting previous request for chat ${chat_id}`);
        prev.abort();
      }
    }
    const abortCtrl = new AbortController();
    if (chat_id) this.activeRequests.set(chat_id, abortCtrl);

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
      // Show "typing…" right away — download + transcription is the slow part of
      // a voice message, and the reply-path typing (below) only starts after it,
      // so without this the chat sits silent for seconds with no feedback.
      const stopVoiceTyping = this._startTyping(chat_id);
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
      stopVoiceTyping(); // reply-path typing takes over from here
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

    // If there's a pending ask_questions flow for this chat AND the current
    // question is free-text, treat this message as the answer rather than a
    // brand-new turn. Returns true when the message was consumed.
    if (chat_id && text && await this._maybeConsumeAskTextAnswer({ chat_id, text })) {
      // Still log the inbound so the chat history records what the user said.
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
          ask_answer: true,
        },
      });
      return;
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
        keepRecent: 40,
        max_age_hours: 24,
      });
      // Progressive compaction (Pieza 3) runs OUT of the reply path: if this
      // chat is over threshold, summarize the oldest turns in the background so
      // the next turn reads a [RESUMEN COMPACTADO] instead of raw history. Never
      // awaited — adds zero latency to this reply, degrades gracefully.
      compactChannelIfNeeded({
        channel: "telegram",
        chat_id,
        config: this.globalConfig,
        log: this.log,
      }).catch(() => {});
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

    // Super-agent is ALWAYS active on Telegram: respond_with_engine === false
    // used to silently drop user messages, which looked to the user like the
    // bot ignored them. Honour the legacy flag only as a soft hint (skip the
    // routed-agent shortcut so we fall straight to super-agent) but never let
    // it short-circuit the whole reply. To genuinely silence the bot, disable
    // the channel entirely (telegram.enabled = false in config).
    const skipRoutedAgent = this.channel.respond_with_engine === false;
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
          actor_id: SUPERAGENT_ACTOR_ID,
          actor_kind: "superagent",
          agent_slug: SUPERAGENT_ACTOR_ID,
          author: resolveAgentName(this.globalConfig),
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
    let replyActorId;   // stable id: super_agent | agent slug
    let replyKind;      // actor_kind: superagent | agent
    const projectCfg = target.config || this.globalConfig;
    // Display name for the super-agent persona on this channel (Roby / APX).
    const agentDisplay = resolveAgentName(this.globalConfig);

    // Try the project's chosen agent first (skipped if the legacy
    // respond_with_engine === false hint asked to bypass routed agents).
    const routeSlug = skipRoutedAgent ? null : this.channel.route_to_agent;
    if (routeSlug) {
      const agent = readAgents(target.path).find((a) => a.slug === routeSlug);
      if (agent && agent.fields.Model) {
        try {
          const system = buildAgentSystem(target, agent, {
            invocation: "telegram",
            channel: this.channel.name,
            caller: author,
            extraParts: [relationshipBlock],
          });
          const result = await callEngine({
            modelId: agent.fields.Model,
            system,
            messages: [{ role: "user", content: text }],
            config: projectCfg,
          });
          replyText = result.text;
          replyAuthor = agent.slug;
          replyActorId = agent.slug;
          replyKind = "agent";
        } catch (e) {
          this.log(`telegram[${this.channel.name}] agent reply failed: ${e.message}`);
          replyText = `[apx error] ${e.message.slice(0, 200)}`;
          replyAuthor = agentDisplay;
          replyActorId = SUPERAGENT_ACTOR_ID;
          replyKind = "superagent";
        }
      } else {
        this.log(
          `telegram[${this.channel.name}] route_to_agent="${routeSlug}" not usable (missing or no model) → trying super-agent`
        );
      }
    }

    // Fallback: super-agent — STREAMED.
    // Each iteration's assistant text is sent to Telegram as its own message
    // the moment the model produces it (its running commentary), so the user
    // sees a real back-and-forth instead of one giant final dump. Tool calls
    // are logged to the message store — visible via apx log / apx search and
    // to channels that render tools — but NEVER sent to Telegram; tools are
    // internal. The conversation saved on disk is the full, real exchange;
    // Telegram is just the prose-only view of it.
    let saUsage = null;
    let streamedCount = 0;
    let lastStreamedText = "";
    // Telegram shows the user ONLY prose — never the tool calls. On an action
    // request the model often jumps straight to a tool with no preamble text,
    // so the user would stare at a silent chat until the final reply. Send one
    // short localized heads-up the moment real work starts (first tool_start),
    // but only if the agent didn't already write its own "on it" line.
    let sentHeadsUp = false;
    const headsUpPhrase = () => {
      const lang = (this.globalConfig?.user?.language || "es").slice(0, 2);
      const byLang = {
        es: "Dale, estoy con eso… 🛠️",
        en: "On it — working on that… 🛠️",
        pt: "Já estou nisso… 🛠️",
      };
      return byLang[lang] || byLang.es;
    };
    if (!replyText && isSuperAgentEnabled(this.globalConfig)) {
      const onEvent = async (ev) => {
        try {
          if (ev.type === "tool_start" && !sentHeadsUp && streamedCount === 0) {
            sentHeadsUp = true;
            const heads = headsUpPhrase();
            await this._send({ chat_id, text: heads });
            appendGlobalMessage({
              channel: "telegram",
              direction: "out",
              type: "agent",
              actor_id: SUPERAGENT_ACTOR_ID,
              actor_kind: "superagent",
              agent_slug: SUPERAGENT_ACTOR_ID,
              author: agentDisplay,
              body: heads,
              meta: { chat_id, tg_channel: this.channel.name, in_reply_to: u.update_id, heads_up: true },
            });
            return;
          }
          if (ev.type === "assistant_text" && ev.text) {
            const piece = stripThinking(ev.text).trim();
            if (!piece) return;
            await this._send({ chat_id, text: piece });
            lastStreamedText = piece;
            streamedCount += 1;
            appendGlobalMessage({
              channel: "telegram",
              direction: "out",
              type: "agent",
              actor_id: SUPERAGENT_ACTOR_ID,
              actor_kind: "superagent",
              agent_slug: SUPERAGENT_ACTOR_ID,
              author: agentDisplay,
              body: piece,
              meta: {
                chat_id,
                tg_channel: this.channel.name,
                in_reply_to: u.update_id,
                streamed: true,
                iteration: ev.iteration,
              },
            });
          } else if (ev.type === "tool_result" && ev.trace) {
            // Logged for the audit trail / other channels — NOT sent to Telegram.
            const t = ev.trace;
            appendGlobalMessage({
              channel: "telegram",
              direction: "out",
              type: "tool",
              actor_id: t.tool,
              actor_kind: "tool",
              author: agentDisplay,
              body: `${t.tool}(${JSON.stringify(t.args || {}).slice(0, 200)})`,
              meta: {
                chat_id,
                tg_channel: this.channel.name,
                in_reply_to: u.update_id,
                tool: t.tool,
                args: t.args,
                result: t.result,
                iteration: ev.iteration,
              },
            });
          }
        } catch (e) {
          // A failed intermediate send must not abort the whole run.
          this.log(`telegram[${this.channel.name}] stream event failed: ${e.message}`);
        }
      };

      const confirmAdapter = createTelegramConfirmAdapter({
        token: resolveBotToken(this.channel),
        chatId: chat_id,
        pendingStore: getConfirmStore(),
      });

      try {
        const sa = await runSuperAgent({
          globalConfig: this.globalConfig,
          projects: this.projects,
          plugins: this.plugins,
          registries: this.registries,
          prompt: text,
          previousMessages,
          channel: "telegram",
          relationshipBlock,
          allowedTools,
          channelMeta: buildTelegramMeta({
            channelName: this.channel.name,
            author,
            chatId: chat_id,
            target,
            routeToAgent: this.channel.route_to_agent,
          }),
          signal: abortCtrl.signal,
          onEvent,
          requestConfirmation: confirmAdapter.requestConfirmation,
        });
        replyText = sa.text;
        replyAuthor = sa.name || agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
        saUsage = sa.usage;

        // ── ask_questions integration ────────────────────────────────────
        // If the super-agent ended this turn by calling ask_questions, hand
        // off to the inline-keyboard flow instead of sending the bare
        // assistant text. The flow keeps state per chat_id and re-runs the
        // super-agent once every answer is collected.
        const askQuestions = askFlow.extractAskQuestionsFromTrace(sa.trace);
        if (askQuestions && chat_id) {
          if (chat_id) this.activeRequests.delete(chat_id);
          stopTyping();
          try {
            await this._startAskFlow({
              chat_id,
              projectId: target?.id,
              authorId: msg.from?.id,
              questions: askQuestions,
              author,
              agentDisplay,
              relationshipBlock,
              allowedTools,
              target,
              sender,
              update_id: u.update_id,
            });
          } catch (e) {
            this.log(`telegram[${this.channel.name}] ask flow start failed: ${e.message}`);
          }
          return; // The reply for this turn IS the ask flow.
        }
      } catch (e) {
        if (abortCtrl.signal.aborted) {
          // A newer message superseded this one. Whatever streamed so far is
          // already sent + logged; the newer message's run continues the
          // thread from that history.
          this.log(`telegram[${this.channel.name}] request aborted for chat ${chat_id}`);
          if (chat_id) this.activeRequests.delete(chat_id);
          stopTyping();
          return;
        }
        this.log(`telegram[${this.channel.name}] super-agent failed: ${e.message}`);
        // Surface the failure to the user instead of silently dropping the
        // turn — otherwise from the chat side it looks like the bot ignored
        // the message. Keep the message short and non-leaking.
        replyText = `⚠️ Could not generate a reply right now (${e.message || "internal error"}).`;
        replyAuthor = agentDisplay;
        replyActorId = SUPERAGENT_ACTOR_ID;
        replyKind = "superagent";
      }
    }

    if (chat_id) this.activeRequests.delete(chat_id);

    // Final answer. The intermediate prose was already streamed; only send the
    // final text if it's non-empty AND not a duplicate of the last streamed
    // piece (the loop can end on an iteration whose text was already sent).
    // If nothing streamed and there's no final text, send a minimal ack so the
    // turn isn't silently empty.
    const finalClean = replyText ? stripThinking(replyText).trim() : "";
    let toSend = "";
    if (finalClean && finalClean !== lastStreamedText) toSend = finalClean;
    else if (!finalClean && streamedCount === 0) toSend = "Listo.";

    stopTyping();
    if (!toSend) return; // everything was already streamed — nothing left to send

    try {
      await this._send({ chat_id, text: toSend });
      const meta = {
        chat_id,
        tg_channel: this.channel.name,
        in_reply_to: u.update_id,
        final: true,
      };
      if (replyText && stripThinking(replyText) !== replyText) meta.thinking_stripped = true;
      if (saUsage) meta.usage = saUsage;
      appendGlobalMessage({
        channel: "telegram",
        direction: "out",
        type: "agent",
        actor_id: replyActorId || SUPERAGENT_ACTOR_ID,
        actor_kind: replyKind || "superagent",
        agent_slug: replyActorId || SUPERAGENT_ACTOR_ID,
        author: replyAuthor || agentDisplay,
        body: toSend,
        meta,
      });
    } catch (e) {
      this.log(`telegram[${this.channel.name}] send-back error: ${e.message}`);
      appendGlobalMessage({
        channel: "telegram",
        direction: "out",
        type: "agent",
        actor_id: replyActorId || SUPERAGENT_ACTOR_ID,
        actor_kind: replyKind || "superagent",
        agent_slug: replyActorId || SUPERAGENT_ACTOR_ID,
        author: replyAuthor || agentDisplay,
        body: `[send_failed] ${toSend}`,
        meta: {
          chat_id,
          tg_channel: this.channel.name,
          in_reply_to: u.update_id,
          send_error: e.message,
          ...(saUsage ? { usage: saUsage } : {}),
        },
      });
    }
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
      channel: "telegram",
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
        channel: "telegram",
        relationshipBlock,
        allowedTools,
        channelMeta: { channel: "telegram", chat_id, author, route_to_agent: this.channel.route_to_agent },
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
          channel: "telegram",
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
      async send({ channel: channelName, chat_id, text, author = resolveAgentName(config), project }) {
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
          channel: "telegram",
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
          channel: "telegram",
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
          channel: "telegram",
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
          channel: "telegram",
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
