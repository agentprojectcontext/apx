// apx status — show full system status at a glance.
// Daemon, super-agent, engines, telegram, projects.

import { readConfig } from "../../../core/config.js";
import { http } from "../http.js";

const R  = "\x1b[0m";
const B  = "\x1b[1m";
const DI = "\x1b[2m";
const CY = "\x1b[36m";
const GR = "\x1b[32m";
const YE = "\x1b[33m";
const RE = "\x1b[31m";
const WH = "\x1b[97m";

const ok  = (s) => `${GR}✓${R} ${s}`;
const off = (s) => `${DI}–${R} ${s}`;
const err = (s) => `${RE}✗${R} ${s}`;
const key = (s) => `  ${DI}${s.padEnd(16)}${R}`;
const val = (s) => `${WH}${s}${R}`;
const sec = (s) => `\n${B}${CY}  ${s}${R}\n`;

export async function cmdStatus() {
  const cfg = readConfig();

  // ── Daemon ─────────────────────────────────────────────────────────────────
  console.log(sec("Daemon"));
  let daemonOk = false;
  let daemonInfo = {};
  try {
    daemonInfo = await http.get("/health");
    daemonOk = true;
  } catch {}

  if (daemonOk) {
    console.log(`  ${ok("running")}   port ${val(daemonInfo.port || cfg.port)}   v${val(daemonInfo.version || "?")}   uptime ${val(formatUptime(daemonInfo.uptime_s))}`);
  } else {
    console.log(`  ${err("stopped")}   run: ${CY}apx daemon start${R}`);
  }

  // ── Super-agent ────────────────────────────────────────────────────────────
  console.log(sec("Super-agent"));
  const sa = cfg.super_agent || {};
  if (sa.enabled) {
    console.log(`  ${ok("enabled")}`);
    console.log(`${key("model")}${val(sa.model || "(not set)")}`);
    if (sa.system) {
      const preview = sa.system.length > 60 ? sa.system.slice(0, 60) + "…" : sa.system;
      console.log(`${key("system")}${DI}${preview}${R}`);
    }
    const fb = sa.model_fallback;
    if (fb?.enabled !== false && Array.isArray(fb?.order)) {
      console.log(`${key("fallback")}${val(fb.order.join(" → "))}`);
    }
    if (cfg.identity?.agent_name) {
      console.log(`${key("identity")}${val(cfg.identity.agent_name)}${cfg.identity.owner_name ? DI + "  for " + cfg.identity.owner_name + R : ""}`);
    }
  } else {
    console.log(`  ${off("disabled")}   run: ${CY}apx setup${R}`);
  }

  // ── Engines ────────────────────────────────────────────────────────────────
  console.log(sec("Engines"));
  const engines = cfg.engines || {};
  const engineList = [
    { id: "anthropic", label: "Anthropic",  check: () => !!engines.anthropic?.api_key },
    { id: "openai",    label: "OpenAI",     check: () => !!engines.openai?.api_key },
    { id: "groq",      label: "Groq",       check: () => !!engines.groq?.api_key,
      detail: () => engines.groq?.base_url || "https://api.groq.com/openai/v1" },
    { id: "openrouter",label: "OpenRouter", check: () => !!engines.openrouter?.api_key,
      detail: () => engines.openrouter?.base_url || "https://openrouter.ai/api/v1" },
    { id: "gemini",    label: "Gemini",     check: () => !!engines.gemini?.api_key },
    { id: "ollama",    label: "Ollama",     check: () => true,
      detail: () => engines.ollama?.base_url || "http://localhost:11434" },
  ];

  for (const e of engineList) {
    const active = sa.model?.startsWith(e.id + ":");
    const configured = e.check();
    const detail = e.detail ? `  ${DI}${e.detail()}${R}` : "";
    const marker = active ? `${YE}← active${R}` : "";
    if (configured) {
      console.log(`  ${ok(e.label.padEnd(12))}${detail}  ${marker}`);
    } else {
      console.log(`  ${off(e.label.padEnd(12))}${DI}(no key)${R}  ${marker}`);
    }
  }

  // ── Telegram ───────────────────────────────────────────────────────────────
  // Prefer the daemon's live view (real polling state). Fall back to the
  // config file only when the daemon is unreachable. The config check must
  // honour BOTH the legacy top-level bot_token AND per-channel tokens.
  console.log(sec("Telegram"));
  const tg = cfg.telegram || {};
  let tgLive = null;
  if (daemonOk) {
    try { tgLive = await http.get("/telegram/status"); } catch {}
  }

  if (tgLive) {
    const channels = tgLive.channels || [];
    const polling = channels.filter((c) => c.polling).length;
    if (!tgLive.enabled) {
      console.log(`  ${off("disabled in config")}   run: ${CY}apx setup${R}`);
    } else if (channels.length === 0) {
      console.log(`  ${off("enabled, no channels")}   run: ${CY}apx setup${R}`);
    } else if (polling === 0) {
      console.log(`  ${err("enabled, not polling")}   run: ${CY}apx telegram start${R}`);
    } else {
      console.log(`  ${ok("polling")}   ${val(`${polling}/${channels.length} channel${channels.length !== 1 ? "s" : ""}`)}`);
    }
    for (const c of channels) {
      const mark = c.polling ? `${GR}●${R}` : `${RE}○${R}`;
      const tok = c.bot_token_present ? "" : ` ${DI}(no token)${R}`;
      const lastErr = c.last_error ? `  ${RE}${c.last_error}${R}` : "";
      console.log(`${key(c.name)}${mark} ${DI}chat ${c.chat_id || "(unset)"}${R}${tok}${lastErr}`);
    }
  } else {
    // Daemon down — best-effort from config. Token may be top-level or per-channel.
    const hasToken = !!tg.bot_token || (tg.channels || []).some((c) => c.bot_token);
    if (tg.enabled && hasToken) {
      console.log(`  ${off("configured")}   ${DI}daemon down — start it to see live status${R}`);
      console.log(`${key("channels")}${val((tg.channels?.length || 1) + " configured")}`);
    } else {
      console.log(`  ${off("disabled")}   run: ${CY}apx setup${R}`);
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  console.log(sec("Projects"));
  let projects = [];
  if (daemonOk) {
    try { projects = await http.get("/projects"); } catch {}
  } else {
    projects = (cfg.projects || []).map((p, i) => ({ id: i + 1, path: p.path, name: p.path?.split("/").pop() || "?", agents: "?" }));
  }

  const registered = projects.filter((p) => p.id !== 0);
  if (registered.length === 0) {
    console.log(`  ${off("none registered")}   run: ${CY}apx project add .${R}`);
  } else {
    for (const p of registered) {
      const agents = p.agents !== "?" ? `  ${DI}${p.agents} agent${p.agents !== 1 ? "s" : ""}${R}` : "";
      console.log(`  ${DI}#${p.id}${R}  ${val(p.name)}${agents}   ${DI}${p.path}${R}`);
    }
  }

  console.log();
}

function formatUptime(s) {
  if (!s) return "?";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
