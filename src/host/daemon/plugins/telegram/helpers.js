// Stateless helpers for the Telegram plugin. Extracted from index.js so the
// big poller class stays focused on lifecycle + message dispatch. Each
// function is pure (no `this`) — instances import them and call as needed.
import fs from "node:fs";
import { TELEGRAM_STATE_PATH } from "#core/config/index.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
    return { channels: raw.channels || {}, _legacy_offset: raw.offset || 0 };
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
 * Resolve the list of telegram channels to poll, honouring both the
 * canonical telegram.channels[] and the legacy single-channel mode.
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
