// Wake-up message — sent via Telegram once per daemon restart (with cooldown).
import fetch from "node-fetch";
import { readIdentity, writeIdentity } from "#core/identity/index.js";
import { callEngine } from "#core/engines/index.js";
import { resolveNudgePolicy, isQuietAt } from "#core/nudge/index.js";
import { resolveChannels, resolveBotToken, resolveChatId } from "#core/channels/telegram/helpers.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";

const WAKEUP_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

const ISO_TO_LANGUAGE = {
  es: "Spanish", en: "English", fr: "French", pt: "Portuguese",
  de: "German", it: "Italian", nl: "Dutch", ru: "Russian",
  ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic",
};

// Exported for unit testing.
// Priority: config.user.language (ISO 639-1) → identity.language → system LANG env.
export function detectLanguage(identity, config) {
  const cfgLang = config?.user?.language;
  if (cfgLang) return ISO_TO_LANGUAGE[cfgLang.toLowerCase()] || cfgLang;
  if (identity?.language) return identity.language;
  const lang = process.env.LANG || process.env.LC_MESSAGES || process.env.LC_ALL || "";
  const code = lang.split(/[_.]/)[0].toLowerCase();
  return ISO_TO_LANGUAGE[code] || "English";
}

/**
 * The model the greeting is written with: the super-agent's OWN model when it
 * has one, else its router model — what Roby answers with everywhere else.
 * This used to be a hardcoded `ollama:qwen2.5:14b`: on a machine where that
 * model was not loaded the greeting fell back to "online. Ready.", and the one
 * morning Ollama happened to answer, a model nobody had chosen wrote the
 * message instead. Null → no model configured → the plain line.
 */
export function wakeupModel(config) {
  const sa = config?.super_agent || {};
  for (const m of [sa.self_model, sa.model]) {
    if (typeof m === "string" && m.includes(":")) return m;
  }
  return null;
}

async function generateMessage(identity, config, callEngineFn = callEngine) {
  const modelId = wakeupModel(config);
  if (!modelId) return null;
  try {
    const language = detectLanguage(identity, config);
    const result = await callEngineFn({
      modelId,
      system: `You are ${identity.agent_name}, an AI agent assistant. Your personality: ${identity.personality || "direct, curious, helpful"}. Your owner is ${identity.owner_name}. Context: ${identity.owner_context || "AI developer"}.`,
      messages: [
        {
          role: "user",
          content:
            `Write a short, creative wake-up message to send when you first come online. ` +
            `Write it in ${language}. ` +
            `Be yourself — direct, slightly witty, concrete. 2-3 sentences max. ` +
            `Mention who you are, who you're here for, and one thing you're ready to help with. ` +
            // The context above can hold local paths (a disk, a folder); a
            // Telegram greeting has no business printing them.
            `Never include file paths, URLs, ids or technical details. ` +
            `No emojis. No greetings like 'Hello!' or 'Hola!' — start differently.`,
        },
      ],
      config,
      maxTokens: 150,
      // Nobody asked for this turn: the spend breaker counts it as unwatched.
      attribution: { channel: CHANNELS.TELEGRAM, agent: SUPERAGENT_ACTOR_ID, unwatched: true },
    });
    return result?.text?.trim() || null;
  } catch {
    return null;
  }
}

async function sendTelegram(token, chatId, text, { silent = false } = {}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(silent ? { disable_notification: true } : {}) }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "telegram send failed");
  return json;
}

export async function triggerWakeup(config, log, deps = {}) {
  const identity = readIdentity();
  if (!identity) return;

  if (!config?.telegram?.enabled) return;
  const channel = resolveChannels(config)[0];
  if (!channel) return;
  const botToken = resolveBotToken(channel);
  const chatId = resolveChatId(channel);
  if (!botToken || !chatId) return;

  // Cooldown check
  if (identity.last_wakeup) {
    const elapsed = Date.now() - new Date(identity.last_wakeup).getTime();
    if (elapsed < WAKEUP_COOLDOWN_MS) return;
  }

  // A SYSTEM notice, not an initiative: "the daemon came back" is an alert
  // the owner needs to see after every restart, so the interruption budget does
  // not get a say (the owner, 2026-09-29: "es un warn o alert, no puede evitarse").
  // It is not counted against the daily allowance either, and carries no
  // "useful / noise" buttons — there is nothing to learn from an alert. The
  // one courtesy it keeps is the quiet hours: inside them it still goes out,
  // WITHOUT sound, so a restart at 3 AM is in the chat in the morning instead
  // of waking anybody up. The 30-minute cooldown above still stops a restart
  // loop from becoming a flood.
  const now = deps.now ? deps.now() : new Date();
  const silent = isQuietAt(resolveNudgePolicy(config).quiet_hours, now);

  try {
    const message = await generateMessage(identity, config, deps.callEngineFn);
    const text = message || `${identity.agent_name} online. Ready.`;
    const sent = await (deps.sendFn || sendTelegram)(botToken, chatId, text, { silent });
    // Into the Telegram thread, like every other message Roby sends there. It
    // went straight to the Bot API and nowhere else, so when the owner asked
    // "where did this come from?" Roby searched its own messages, found
    // nothing, and could not say — it had never seen itself send it.
    appendGlobalMessage({
      channel: CHANNELS.TELEGRAM,
      direction: "out",
      type: "agent",
      actor_id: SUPERAGENT_ACTOR_ID,
      actor_kind: "superagent",
      agent_slug: SUPERAGENT_ACTOR_ID,
      author: identity.agent_name || undefined,
      body: text,
      meta: {
        chat_id: chatId,
        tg_channel: channel.name,
        wakeup: true,
        ...(silent ? { silent: true } : {}),
        ...(message ? { model: wakeupModel(config) } : {}),
        ...(sent?.result?.message_id ? { external_id: String(sent.result.message_id) } : {}),
      },
    });
    writeIdentity({ last_wakeup: new Date().toISOString() });
    log?.(`wakeup: sent to Telegram chat ${chatId}${silent ? " without sound (quiet hours)" : ""}${message ? ` (written by ${wakeupModel(config)})` : " (plain line: no model answered)"}`);
  } catch (e) {
    log?.(`wakeup: failed — ${e.message}`);
  }
}
