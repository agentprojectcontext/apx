// Wake-up message — sent via Telegram once per daemon restart (with cooldown).
import fetch from "node-fetch";
import { readIdentity, writeIdentity } from "#core/identity/index.js";
import { resolveProvider, getAdapter } from "#core/engines/index.js";

const WAKEUP_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

const ISO_TO_LANGUAGE = {
  es: "Spanish", en: "English", fr: "French", pt: "Portuguese",
  de: "German", it: "Italian", nl: "Dutch", ru: "Russian",
  ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic",
};

// Exported for unit testing.
// Priority: config.user.language (ISO 639-1) → identity.language (legacy) → system LANG env.
export function detectLanguage(identity, config) {
  const cfgLang = config?.user?.language;
  if (cfgLang) return ISO_TO_LANGUAGE[cfgLang.toLowerCase()] || cfgLang;
  if (identity?.language) return identity.language;
  const lang = process.env.LANG || process.env.LC_MESSAGES || process.env.LC_ALL || "";
  const code = lang.split(/[_\.]/)[0].toLowerCase();
  return ISO_TO_LANGUAGE[code] || "English";
}

async function generateMessage(identity, engineConfig) {
  try {
    const { provider, model } = resolveProvider("ollama:qwen2.5:14b");
    const engine = getAdapter(provider);
    const language = detectLanguage(identity, engineConfig);
    const result = await engine.chat({
      system: `You are ${identity.agent_name}, an AI agent assistant. Your personality: ${identity.personality || "direct, curious, helpful"}. Your owner is ${identity.owner_name}. Context: ${identity.owner_context || "AI developer"}.`,
      messages: [
        {
          role: "user",
          content:
            `Write a short, creative wake-up message to send when you first come online. ` +
            `Write it in ${language}. ` +
            `Be yourself — direct, slightly witty, concrete. 2-3 sentences max. ` +
            `Mention who you are, who you're here for, and one thing you're ready to help with. ` +
            `No emojis. No greetings like 'Hello!' or 'Hola!' — start differently.`,
        },
      ],
      model,
      config: engineConfig?.engines?.ollama || {},
      maxTokens: 150,
    });
    return result.text?.trim() || null;
  } catch {
    return null;
  }
}

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "telegram send failed");
  return json;
}

export async function triggerWakeup(config, log) {
  const identity = readIdentity();
  if (!identity) return;

  const tg = config.telegram;
  if (!tg?.enabled || !tg?.bot_token || !tg?.chat_id) return;

  // Cooldown check
  if (identity.last_wakeup) {
    const elapsed = Date.now() - new Date(identity.last_wakeup).getTime();
    if (elapsed < WAKEUP_COOLDOWN_MS) return;
  }

  try {
    const message = await generateMessage(identity, config);
    const text = message || `${identity.agent_name} online. Ready.`;
    await sendTelegram(tg.bot_token, tg.chat_id, text);
    writeIdentity({ last_wakeup: new Date().toISOString() });
    log?.(`wakeup: sent to Telegram chat ${tg.chat_id}`);
  } catch (e) {
    log?.(`wakeup: failed — ${e.message}`);
  }
}
