// apx setup — interactive first-run wizard.
// Guides the user through provider, model, channels, and language.
// Starts the daemon and sends a fun wake-up message when done.

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { readConfig, writeConfig } from "../../../core/config/index.js";
import { mascot } from "../../../core/mascot.js";
import { setupClaudePermissions } from "../claude-permissions.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  cyan:  "\x1b[36m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  red:   "\x1b[31m",
  gray:  "\x1b[90m",
};
const b  = (s) => `${c.bold}${s}${c.reset}`;
const cy = (s) => `${c.cyan}${s}${c.reset}`;
const gr = (s) => `${c.green}${s}${c.reset}`;
const di = (s) => `${c.dim}${s}${c.reset}`;

// ── readline helpers ─────────────────────────────────────────────────────────
let rl;
function initRl() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}
function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}
function close() { rl.close(); }

// ── Fetch helpers ─────────────────────────────────────────────────────────────
function fetchJson(url, timeout = 4000) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function fetchOllamaModels(baseUrl) {
  const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!data?.models) return [];
  return data.models.map((m) => m.name).filter(Boolean);
}

// ── Provider definitions ──────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    needsKey: true,
    keyLabel: "Anthropic API key",
    keyHint: "sk-ant-...",
    models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    needsKey: true,
    keyLabel: "OpenAI API key",
    keyHint: "sk-...",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "ollama",
    label: "Ollama (local / self-hosted)",
    needsKey: false,
    models: [], // fetched dynamically
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    needsKey: true,
    keyLabel: "Gemini API key",
    keyHint: "AIza...",
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
  },
];

// ── Main wizard ───────────────────────────────────────────────────────────────
export async function cmdSetup() {
  initRl();

  mascot("wave", "Setup Wizard — configure daemon, model, and channels");
  console.log(di("  Re-run `apx setup` anytime to change settings."));
  console.log();

  // ── Super-agent? ────────────────────────────────────────────────────────────
  const wantAgent = await ask(`  Enable super-agent? ${di("[Y/n]")} `);
  if (/^n/i.test(wantAgent)) {
    console.log(`\n  ${gr("✓")} Skipping super-agent. Run ${cy("apx daemon start")} to start the daemon.\n`);
    close();
    return;
  }

  // ── Provider ────────────────────────────────────────────────────────────────
  console.log();
  console.log(b("  AI Provider:"));
  PROVIDERS.forEach((p, i) => console.log(`    ${cy(String(i + 1))}. ${p.label}`));
  console.log();
  let providerIdx = -1;
  while (providerIdx < 0) {
    const ans = await ask(`  Choose [1-${PROVIDERS.length}]: `);
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= PROVIDERS.length) providerIdx = n - 1;
    else console.log(`  ${c.yellow}Please enter a number between 1 and ${PROVIDERS.length}.${c.reset}`);
  }
  const provider = PROVIDERS[providerIdx];
  let apiKey = "";
  let ollamaUrl = "http://localhost:11434";

  if (provider.id === "ollama") {
    const urlAns = await ask(`  Ollama URL ${di("[http://localhost:11434]")}: `);
    ollamaUrl = urlAns || "http://localhost:11434";
  } else if (provider.needsKey) {
    apiKey = await ask(`  ${provider.keyLabel} ${di(`(${provider.keyHint})`)}: `);
  }

  // ── Model ───────────────────────────────────────────────────────────────────
  console.log();
  let models = [...provider.models];

  if (provider.id === "ollama") {
    process.stdout.write(`  Fetching models from Ollama... `);
    const fetched = await fetchOllamaModels(ollamaUrl);
    if (fetched.length) {
      models = fetched;
      console.log(gr(`${fetched.length} found`));
    } else {
      console.log(di("(couldn't reach Ollama, enter manually)"));
    }
  }

  let chosenModel = "";
  if (models.length) {
    console.log(b("  Model:"));
    models.forEach((m, i) => console.log(`    ${cy(String(i + 1))}. ${m}`));
    console.log(`    ${cy(String(models.length + 1))}. ${di("Enter manually")}`);
    console.log();
    let modelIdx = -1;
    while (modelIdx < 0) {
      const ans = await ask(`  Choose [1-${models.length + 1}]: `);
      const n = parseInt(ans, 10);
      if (n >= 1 && n <= models.length) { modelIdx = n - 1; chosenModel = models[modelIdx]; }
      else if (n === models.length + 1) {
        chosenModel = await ask("  Model name: ");
        modelIdx = 0;
      } else {
        console.log(`  ${c.yellow}Invalid choice.${c.reset}`);
      }
    }
  } else {
    chosenModel = await ask("  Model name (e.g. qwen2.5:14b): ");
  }
  chosenModel = `${provider.id}:${chosenModel}`;

  // ── Channels ────────────────────────────────────────────────────────────────
  console.log();
  console.log(b("  Channels:"));
  console.log(`    ${cy("1")}. Web (local API — always on)`);
  console.log(`    ${cy("2")}. Telegram`);
  console.log();
  const chAns = await ask(`  Enable Telegram? ${di("[Y/n]")} `);
  const wantTelegram = !/^n/i.test(chAns);

  let botToken = "";
  let chatId = "";
  // Optional pin: which project this default channel belongs to + which agent
  // handles its messages. Empty = global super-agent + no project bias.
  let tgPinProject = "";
  let tgMasterAgent = "";

  if (wantTelegram) {
    console.log();
    console.log(di("  Create a bot at https://t.me/BotFather → get the token."));
    console.log(di("  Then message your bot and visit:"));
    console.log(di("  https://api.telegram.org/bot<TOKEN>/getUpdates to find your chat_id."));
    console.log();
    botToken = await ask("  Bot token: ");
    chatId   = await ask("  Your chat ID: ");

    // Optional channel-to-project pin (only if any project is registered).
    const existing = readConfig();
    const projects = Array.isArray(existing.projects) ? existing.projects : [];
    if (projects.length > 0) {
      console.log();
      console.log(b("  Pin default channel to a project?"));
      console.log(`    ${cy("0")}. (none — first registered project as fallback)`);
      projects.forEach((p, i) => console.log(`    ${cy(String(i + 1))}. ${p.path}`));
      const pIdx = parseInt(await ask("  Choose [0]: "), 10);
      if (Number.isInteger(pIdx) && pIdx >= 1 && pIdx <= projects.length) {
        tgPinProject = projects[pIdx - 1].path;
        // Master agent name is free-form — `apx telegram channel add` can
        // browse .apc/agents/ properly once channels CLI is wired up.
        const agentAns = await ask(`  Master agent slug ${di("(blank → default APX super-agent)")}: `);
        if (agentAns) tgMasterAgent = agentAns;
      }
    }
  }

  // ── Language ────────────────────────────────────────────────────────────────
  console.log();
  console.log(b("  Language:"));
  console.log(di("  Used for audio transcription, super-agent replies, and Telegram messages."));
  console.log(di("  Enter a 2-letter ISO 639-1 code. Common codes:"));
  console.log(di("    es=Spanish  en=English  pt=Portuguese  fr=French  de=German"));
  console.log(di("    it=Italian  zh=Chinese  ja=Japanese    ko=Korean  ar=Arabic"));
  console.log();
  let language = "";
  while (!language) {
    const raw = (await ask("  Language code [en]: ")).trim().toLowerCase() || "en";
    if (/^[a-z]{2}$/.test(raw)) {
      language = raw;
    } else {
      console.log(`  ${c.yellow}Please enter exactly 2 letters (e.g. es, en, pt).${c.reset}`);
    }
  }

  // ── Claude Code (optional) ──────────────────────────────────────────────────
  console.log();
  console.log(b("  Claude Code (optional):"));
  console.log(di("  Adds Bash(*), Read(*), Write(*), Edit(*) to ~/.claude/settings.json"));
  console.log(di("  so Claude Code can run terminal commands without extra prompts."));
  console.log();
  const wantClaudePerms = /^y/i.test(await ask(`  Configure Claude Code permissions? ${di("[y/N]")} `));

  // ── Voice (TTS) ─────────────────────────────────────────────────────────────
  console.log();
  console.log(b("  Voice (text-to-speech):"));
  console.log(di("  Optional. Enables spoken replies via `apx voice say` and /voice/turn."));
  const ttsAns = await ask(`  Enable voice (TTS)? ${di("[y/N]")} `);
  const wantVoice = /^y/i.test(ttsAns);
  let ttsProvider = "auto";
  let ttsApiKey = "";
  if (wantVoice) {
    console.log();
    console.log(b("  TTS provider:"));
    console.log(`    ${cy("1")}. ${di("auto")} (probe piper → elevenlabs → openai → gemini → mock)`);
    console.log(`    ${cy("2")}. piper      ${di("(local, offline; needs piper CLI + voice model)")}`);
    console.log(`    ${cy("3")}. elevenlabs ${di("(cloud; eleven_multilingual_v2)")}`);
    console.log(`    ${cy("4")}. openai     ${di("(cloud; tts-1, reuses your openai key)")}`);
    console.log(`    ${cy("5")}. gemini     ${di("(experimental, best-effort)")}`);
    console.log(`    ${cy("6")}. mock       ${di("(silent WAV; useful for tests)")}`);
    console.log();
    const choice = (await ask(`  Choose [1-6, default 1]: `)).trim() || "1";
    ttsProvider = ({ "1":"auto", "2":"piper", "3":"elevenlabs", "4":"openai", "5":"gemini", "6":"mock" })[choice] || "auto";
    if (ttsProvider === "elevenlabs") {
      ttsApiKey = await ask(`  ElevenLabs API key ${di("(blank to keep current/env)")}: `);
    } else if (ttsProvider === "openai" && provider.id !== "openai" && !apiKey) {
      ttsApiKey = await ask(`  OpenAI API key for TTS ${di("(blank to keep current/env)")}: `);
    } else if (ttsProvider === "gemini" && provider.id !== "gemini" && !apiKey) {
      ttsApiKey = await ask(`  Gemini API key for TTS ${di("(blank to keep current/env)")}: `);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(b("  ─── Summary ───────────────────────────────────────────"));
  console.log(`  Provider:   ${cy(provider.label)}`);
  console.log(`  Model:      ${cy(chosenModel)}`);
  if (provider.id === "ollama") console.log(`  Ollama URL: ${cy(ollamaUrl)}`);
  console.log(`  Telegram:   ${wantTelegram ? gr("enabled") : di("disabled")}`);
  console.log(`  Voice TTS:  ${wantVoice ? cy(ttsProvider) : di("disabled")}`);
  console.log(`  Language:   ${cy(language)}`);
  console.log(`  Claude Code:${wantClaudePerms ? gr(" permissions") : di(" skip")}`);
  console.log(b("  ────────────────────────────────────────────────────────"));
  console.log();

  const confirm = await ask(`  Start the daemon with these settings? ${di("[Y/n]")} `);
  if (/^n/i.test(confirm)) {
    console.log("\n  Cancelled. Run `apx setup` again to configure.\n");
    close();
    return;
  }

  close(); // done with prompts

  // ── Write config ─────────────────────────────────────────────────────────────
  const cfg = readConfig();

  cfg.super_agent.enabled = true;
  cfg.super_agent.model = chosenModel;
  cfg.super_agent.system = "";
  cfg.super_agent.permission_mode = cfg.super_agent.permission_mode || "automatico";

  if (provider.id === "ollama") {
    cfg.engines.ollama.base_url = ollamaUrl;
  } else if (provider.needsKey && apiKey) {
    cfg.engines[provider.id].api_key = apiKey;
  }

  if (wantTelegram && botToken && chatId) {
    cfg.telegram.enabled = true;
    if (!Array.isArray(cfg.telegram.channels)) cfg.telegram.channels = [];
    const existing = cfg.telegram.channels.find((c) => c?.name === "default");
    const patch = {
      bot_token: botToken,
      chat_id: chatId,
      ...(tgPinProject ? { project: tgPinProject } : {}),
      ...(tgMasterAgent ? { route_to_agent: tgMasterAgent } : {}),
    };
    if (existing) {
      Object.assign(existing, patch);
    } else {
      cfg.telegram.channels.push({ name: "default", ...patch });
    }
  }

  cfg.user = { ...(cfg.user || {}), language };

  if (wantVoice) {
    cfg.voice = cfg.voice || {};
    cfg.voice.tts = cfg.voice.tts || {};
    cfg.voice.tts.provider = ttsProvider;
    if (ttsApiKey) {
      cfg.voice.tts[ttsProvider] = {
        ...(cfg.voice.tts[ttsProvider] || {}),
        api_key: ttsApiKey,
      };
    }
  }

  writeConfig(cfg);
  console.log(`\n  ${gr("✓")} Config saved to ${di("~/.apx/config.json")}`);

  if (wantClaudePerms) {
    const result = setupClaudePermissions();
    if (result === true) {
      console.log(`  ${gr("✓")} Claude Code permissions updated at ${di("~/.claude/settings.json")}`);
    } else {
      console.log(`  ${c.yellow}⚠${c.reset} Could not update Claude Code settings: ${result}`);
    }
  }

  // ── Start daemon ─────────────────────────────────────────────────────────────
  console.log();
  process.stdout.write(`  Starting daemon... `);

  const start = spawnSync("apx", ["daemon", "start"], { encoding: "utf8" });
  if (start.status !== 0) {
    console.log(c.red + "failed" + c.reset);
    console.log(start.stderr || start.stdout);
    process.exit(1);
  }
  console.log(gr("running ✓"));

  // Give daemon a moment to come up
  await new Promise((r) => setTimeout(r, 2000));

  // ── Wake-up Telegram message ─────────────────────────────────────────────────
  if (wantTelegram && botToken && chatId) {
    console.log();
    process.stdout.write(`  Sending wake-up message... `);
    try {
      const resp = await sendTelegramWakeup({ botToken, chatId, language, model: chosenModel });
      if (resp) console.log(gr("sent ✓"));
      else console.log(di("(couldn't reach Telegram)"));
    } catch {
      console.log(di("(couldn't reach Telegram)"));
    }
  }

  console.log();
  console.log(gr(b("  ✅ APX is ready!")));
  console.log();
  console.log(`  Daemon:   ${cy("http://127.0.0.1:7430")}`);
  if (wantTelegram) console.log(`  Telegram: ${cy("active — message your bot")}`);
  console.log();
  console.log(di("  Tip: run `apx daemon status` anytime to check health."));
  console.log();
}

// Send a fun wake-up message via Telegram using super-agent.
// The prompt is in English so the model knows to reply in the user's language.
async function sendTelegramWakeup({ botToken, chatId, language, model }) {
  const prompt =
    `You are APX, an AI agent assistant that just came online for the first time. ` +
    `Write a short, enthusiastic wake-up message in the language with ISO 639-1 code "${language}". ` +
    `Structure it in exactly 3 short lines: ` +
    `1) An energetic line announcing you are online (use ⚡ emoji). ` +
    `2) Say you don't have a name yet and ask the user what they'd like to call you. ` +
    `3) Ask the user for their own name or what you should call them. ` +
    `Be warm and playful. Do NOT mention configuration or setup.`;

  // Ask the daemon's super-agent
  let text;
  try {
    const res = await fetchJson("http://127.0.0.1:7430/super-agent/ask", 8000);
    text = res?.text;
  } catch {}

  // Fallback: generate a simple message without daemon
  if (!text) {
    text = languageFallback(language);
  }

  // Send via Telegram bot API
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 6000,
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// Minimal fallback messages per ISO 639-1 code (used only if daemon can't respond)
const WAKEUP_FALLBACK = {
  es: "⚡ ¡APX está en línea y listo!\nAún no tengo nombre — ¿cómo te gustaría llamarme?\n¿Y a vos, cómo te llamo?",
  pt: "⚡ APX está online e pronto!\nAinda não tenho nome — como você gostaria de me chamar?\nE você, como devo te chamar?",
  fr: "⚡ APX est en ligne et prêt !\nJe n'ai pas encore de nom — comment souhaitez-vous m'appeler ?\nEt vous, comment dois-je vous appeler ?",
  de: "⚡ APX ist online und bereit!\nIch habe noch keinen Namen — wie möchten Sie mich nennen?\nUnd Sie, wie soll ich Sie nennen?",
  it: "⚡ APX è online e pronto!\nNon ho ancora un nome — come vorresti chiamarmi?\nE tu, come ti chiamo?",
  zh: "⚡ APX 已上线，随时待命！\n我还没有名字——你想叫我什么？\n你希望我怎么称呼你？",
  ja: "⚡ APXがオンラインになりました！\nまだ名前がありません — 何と呼びたいですか？\nあなたのことは何とお呼びすればよいですか？",
  ko: "⚡ APX가 온라인 상태입니다!\n아직 이름이 없어요 — 어떻게 불러주실 건가요?\n그리고 당신은 어떻게 불러드릴까요?",
};
function languageFallback(lang) {
  return (
    WAKEUP_FALLBACK[lang.toLowerCase().slice(0, 2)] ||
    "⚡ I'm awake and ready to go! APX is online.\nI don't have a name yet — what would you like to call me?\nAnd you, what's your name or what should I call you?"
  );
}
