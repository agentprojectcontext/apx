// Stateless helpers for the Telegram plugin. Extracted from index.js so the
// big poller class stays focused on lifecycle + message dispatch. Each
// function is pure (no `this`) — instances import them and call as needed.
import fs from "node:fs";
import path from "node:path";
import { TELEGRAM_STATE_PATH, APX_HOME } from "#core/config/index.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Display label for a Telegram sender used as the `author` / actor fallback:
 *   @username  →  "First Last"  →  "unknown".
 * Single source of truth so every inbound branch (text/photo/audio) and the
 * message store agree. NOTE: this is the raw handle; the *resolved contact
 * name* (which prefers a saved roster name) is `resolveSender().name` in
 * core/identity/telegram.js — different purpose, don't conflate them.
 */
export function telegramAuthorLabel(from) {
  if (from?.username) return "@" + from.username;
  const full = `${from?.first_name || ""} ${from?.last_name || ""}`.trim();
  return full || "unknown";
}

/**
 * Ensure and return the shared media-download directory (~/.apx/media).
 * Owns BOTH the path and the mkdir so callers never touch `fs`/`APX_HOME`
 * directly — the inbound dispatcher used to inline this and a module split
 * dropped its `fs`/`APX_HOME` imports, silently breaking every photo/voice.
 */
export function telegramMediaDir() {
  const dir = path.join(APX_HOME, "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Build the channelMeta block the super-agent loop receives for a Telegram
 * turn. The prompt template at src/core/agent/prompts/channels/telegram.md
 * interpolates `{{projectBlock}}` and `{{routeBlock}}` verbatim, so we
 * pre-render them as plain text (the template engine doesn't do conditionals).
 */
export function buildTelegramMeta({ channelName, author, chatId, target, routeToAgent }) {
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
    ...(target ? {
      projectId:   String(target.id),
      projectName: target.name || "",
      projectPath: target.path || "",
    } : {}),
    ...(routeToAgent ? { routeToAgent } : {}),
  };
}

/** Load the cross-channel offset state from ~/.apx/telegram-state.json. */
export function loadState() {
  if (!fs.existsSync(TELEGRAM_STATE_PATH)) return { channels: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(TELEGRAM_STATE_PATH, "utf8"));
    return { channels: raw.channels || {} };
  } catch {
    return { channels: {} };
  }
}

/** Write the cross-channel offset state. Adds an `updated_at` timestamp. */
export function saveState(state) {
  fs.writeFileSync(
    TELEGRAM_STATE_PATH,
    JSON.stringify({ ...state, updated_at: nowIso() }, null, 2) + "\n"
  );
}

export function resolveBotToken(channel) {
  return (
    channel.bot_token ||
    process.env.BOT_TELEGRAM_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
  );
}

export function resolveChatId(channel) {
  return (
    channel.chat_id ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.BOT_TELEGRAM_CHAT_ID ||
    ""
  );
}

export function tokenSource(channel) {
  if (channel.bot_token) return "config";
  if (process.env.BOT_TELEGRAM_TOKEN) return "env:BOT_TELEGRAM_TOKEN";
  if (process.env.TELEGRAM_BOT_TOKEN) return "env:TELEGRAM_BOT_TOKEN";
  return null;
}

/**
 * Resolve the list of telegram channels to poll. Credentials live in
 * telegram.channels[]; with none configured we fall back to a single implicit
 * "default" channel whose token/chat id come from the environment.
 */
export function resolveChannels(globalConfig) {
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
  // Env-only mode: no channels configured, but a token is in the environment.
  // resolveBotToken()/resolveChatId() fill the blanks from BOT_TELEGRAM_TOKEN
  // / TELEGRAM_CHAT_ID at call time.
  if (!process.env.BOT_TELEGRAM_TOKEN && !process.env.TELEGRAM_BOT_TOKEN) {
    return [];
  }
  return [
    {
      name: "default",
      bot_token: "",
      chat_id: "",
      route_to_agent: tg.route_to_agent || "",
      project: null,
      respond_with_engine: tg.respond_with_engine !== false,
      poll_interval_ms: tg.poll_interval_ms || 1500,
    },
  ];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop this chat's AbortController only if it is still the one we own.
 * An aborted turn used to `activeRequests.delete(chat_id)` unconditionally,
 * which wiped the NEWER turn's controller and made the next interrupt a no-op.
 */
export function releaseActiveRequest(activeRequests, chat_id, abortCtrl) {
  if (chat_id && activeRequests.get(chat_id) === abortCtrl) {
    activeRequests.delete(chat_id);
  }
}

// Below this, a resend of the same text is impatience, not a new instruction.
// Past it, the run has been going long enough that "again" plausibly means
// "that is stuck, start over" — so the interrupt goes through as usual.
const RESEND_WINDOW_MS = 10 * 60_000;

/** Comparable form of a chat message: case, accents and punctuation dropped. */
function normalizeForResend(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Is this inbound the SAME message the chat is already working on?
 *
 * Default Interrupt aborts the running turn on every new message, which is
 * right for "no, stop, do this instead" and exactly wrong for the case that
 * actually happens: a long turn goes quiet (one progress note per 90s), the
 * user assumes it died and sends the same request again. The resend killed the
 * work in flight and restarted it from zero — so the next one looked stuck too.
 * Six resends of one message in 35 minutes, and nothing ever finished.
 *
 * A verbatim repeat inside the window is treated as "still here?", not as a new
 * turn: the running work keeps its abort controller and finishes.
 *
 * @returns {boolean} true when the caller should let the running turn continue.
 */
export function isImpatientResend(prev, text, { now = Date.now } = {}) {
  if (!prev?.text) return false;
  const incoming = normalizeForResend(text);
  if (!incoming) return false;
  if (incoming !== normalizeForResend(prev.text)) return false;
  return now() - (prev.startedAt || 0) < RESEND_WINDOW_MS;
}
