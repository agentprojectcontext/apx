import { readConfig, writeConfig } from "#core/config/index.js";
import {
  probeAllProviders,
  resolveActiveModel,
  fallbackModels,
  parseModelId,
  DEFAULT_FALLBACK_ORDER,
} from "#core/agent/model-router.js";

function providersFromFallback(cfg) {
  const seen = [];
  for (const m of fallbackModels(cfg)) {
    try {
      const p = parseModelId(m).provider;
      if (!seen.includes(p)) seen.push(p);
    } catch { /* skip malformed */ }
  }
  return seen.length ? seen : [...DEFAULT_FALLBACK_ORDER];
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function setNested(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function ensureFallback(cfg) {
  cfg.super_agent = cfg.super_agent || {};
  cfg.super_agent.model_fallback = cfg.super_agent.model_fallback || {};
  if (!Array.isArray(cfg.super_agent.model_fallback.order) || !cfg.super_agent.model_fallback.order.length) {
    cfg.super_agent.model_fallback.order = [...DEFAULT_FALLBACK_ORDER];
  }
  cfg.super_agent.model_fallback.models = cfg.super_agent.model_fallback.models || {};
  cfg.engines = cfg.engines || {};
  for (const p of ["groq", "openrouter"]) {
    cfg.engines[p] = cfg.engines[p] || {};
  }
  return cfg;
}

export async function cmdModel(args = {}) {
  const sub = args._[0] || "status";
  const cfg = ensureFallback(readConfig());

  if (sub === "status" || sub === "show") {
    const probes = await probeAllProviders(cfg, cfg.super_agent.model_fallback.health_timeout_ms);
    let active = null;
    try {
      active = await resolveActiveModel(cfg);
    } catch {
      /* no model */
    }

    console.log("Model router");
    console.log(`  primary:   ${cfg.super_agent.model || "(not set)"}`);
    console.log(`  fallback:  ${cfg.super_agent.model_fallback.enabled !== false ? "on" : "off"}`);
    console.log(`  order:     ${providersFromFallback(cfg).join(" → ")}`);
    if (active) {
      console.log(`  active:    ${active.modelId}${active.fromFallback ? " (fallback)" : ""}`);
    }
    console.log("");
    for (const p of probes) {
      const key = cfg.engines?.[p.provider]?.api_key ? "key:config" : "(no key)";
      const mark = p.ok ? "✓" : "✗";
      console.log(`  ${mark} ${p.provider.padEnd(12)} ${String(p.model).slice(0, 40).padEnd(42)} ${p.ok ? "up" : p.reason || "down"}  ${key}`);
    }
    console.log("");
    console.log("Keys → ~/.apx/config.json engines.{groq,openrouter}.api_key");
    console.log("Or env: GROQ_API_KEY, OPENROUTER_API_KEY");
    return;
  }

  if (sub === "order" || sub === "set-order") {
    const providers = args._.slice(1).map(String).map((s) => s.toLowerCase());
    if (!providers.length) {
      throw new Error(`usage: apx model order ${DEFAULT_FALLBACK_ORDER.join(" ")}`);
    }
    cfg.super_agent.model_fallback.order = providers;
    writeConfig(cfg);
    console.log(`fallback order: ${providers.join(" → ")}`);
    return;
  }

  if (sub === "key" || sub === "set-key") {
    const provider = String(args._[1] || "").toLowerCase();
    const key = args._.slice(2).join(" ").trim();
    if (!provider || !key) {
      throw new Error("usage: apx model key <groq|openrouter|openai> <api-key>");
    }
    if (!cfg.engines[provider]) cfg.engines[provider] = {};
    cfg.engines[provider].api_key = key;
    writeConfig(cfg);
    console.log(`engines.${provider}.api_key set (${key.slice(0, 6)}…)`);
    console.log("Run: apx daemon reload");
    return;
  }

  if (sub === "set") {
    const provider = String(args._[1] || "").toLowerCase();
    const modelId = args._.slice(2).join(" ").trim();
    if (!provider || !modelId) {
      throw new Error("usage: apx model set <provider> <provider:model-id>");
    }
    cfg.super_agent.model_fallback.models[provider] = modelId;
    writeConfig(cfg);
    console.log(`model_fallback.models.${provider} = ${modelId}`);
    return;
  }

  if (sub === "test") {
    const routing = await resolveActiveModel(cfg);
    console.log(`resolved: ${routing.modelId} (${routing.provider})`);
    if (routing.fromFallback) console.log("(via fallback — primary provider down or skipped)");
    return;
  }

  if (sub === "enable") {
    cfg.super_agent.model_fallback.enabled = true;
    writeConfig(cfg);
    console.log("model fallback: enabled");
    return;
  }

  if (sub === "disable") {
    cfg.super_agent.model_fallback.enabled = false;
    writeConfig(cfg);
    console.log("model fallback: disabled");
    return;
  }

  throw new Error(`unknown model subcommand: ${sub}. Try: status | order | key | set | test | enable | disable`);
}

