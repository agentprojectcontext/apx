// Progressive history compaction (Pieza 3).
//
// When a channel chat accumulates more than `maxTurns` (60) conversational
// turns in the rolling window, the oldest turns beyond `keepRecent` (40) are
// collapsed into a dense summary by a light LLM (ollama:gemma2 → haiku
// fallback) and persisted as a `type:"compact"` record in the channel JSONL.
//
// The reader (getRecentChannelTurnsFromFs) then prepends that summary as a
// [RESUMEN COMPACTADO] system turn and drops the raw turns it covers, keeping
// the model context bounded while preserving decisions / tasks / tool results.
//
// This runs OUT of the reply hot path (fire-and-forget) — generating a summary
// costs an LLM call, so the current turn uses whatever compact already exists
// and the next turn benefits. Best-effort: any failure logs and returns.

import fs from "node:fs";
import path from "node:path";
import { GLOBAL_MESSAGES_DIR } from "../config/index.js";
import { parseDayJsonl, appendGlobalMessage } from "../stores/messages.js";
import { callEngine } from "../engines/index.js";

const DEFAULT_MAX_TURNS = 60;
const DEFAULT_KEEP_RECENT = 40;
const COMPACT_MAX_TOKENS = 1000; // ~800-token target + headroom

const COMPACT_SYSTEM =
  "Compactás conversaciones para continuidad de contexto de un agente. " +
  "Otro modelo va a leer esto para seguir el trabajo: sé denso y factual.";

function compactPrompt(transcript) {
  return (
    "Compactá estos turnos en un resumen estructurado de máximo 800 tokens, " +
    "preservando: decisiones tomadas, tareas asignadas, resultados de tools, y " +
    "datos acordados. Sin saludos ni meta-comentarios. Sólo los hechos.\n\n" +
    "---\n\n" +
    transcript
  );
}

export function resolveCompactModels(config = {}) {
  const mem = config.memory || {};
  // Primary: a light, local-endpoint model (Ollama, incl. *-cloud models served
  // via localhost). Fallback: whatever the user configured, else the APX
  // default super-agent model — never silently a paid service the user didn't
  // pick. A blank fallback resolves to super_agent.model at call time.
  return {
    primary: mem.compact_model || "ollama:gemma4:31b-cloud",
    fallback: mem.compact_fallback_model || config.super_agent?.model || "",
  };
}

// Read every record for a chat in the rolling window, oldest first.
function readChatRecords({ channel, chat_id, max_age_hours, messagesDir }) {
  const cutoff = new Date(Date.now() - max_age_hours * 3600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const dir = path.join(messagesDir, channel);
  if (!fs.existsSync(dir)) return [];
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const m of parseDayJsonl(text)) {
      if (m.ts < cutoff) continue;
      if (String(m.meta?.chat_id ?? "") !== String(chat_id)) continue;
      all.push(m);
    }
  }
  all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return all;
}

function renderTurn(m) {
  if (m.type === "tool") {
    const name = m.meta?.tool_name || m.meta?.tool || "tool";
    return `[TOOL ${name}]\n${String(m.body || "").slice(0, 600)}`;
  }
  const who = m.type === "user" ? "USER" : "ASSISTANT";
  return `[${who}]\n${String(m.body || "")}`;
}

async function summarize({ transcript, models, config }) {
  for (const modelId of [models.primary, models.fallback]) {
    if (!modelId) continue;
    try {
      const r = await callEngine({
        modelId,
        system: COMPACT_SYSTEM,
        messages: [{ role: "user", content: compactPrompt(transcript) }],
        config,
        maxTokens: COMPACT_MAX_TOKENS,
        temperature: 0.2,
      });
      const text = String(r.text || "").trim();
      if (text) return { text, model: modelId };
    } catch {
      /* try next model */
    }
  }
  return null;
}

// Compact one channel chat if it's over threshold. Returns a small status obj.
// opts: { channel, chat_id, config, log, maxTurns, keepRecent, max_age_hours,
//         messagesDir }  (messagesDir overridable for tests)
export async function compactChannelIfNeeded(opts = {}) {
  const channel = opts.channel || "telegram";
  const chat_id = opts.chat_id;
  const config = opts.config || {};
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const maxTurns = opts.maxTurns ?? config.memory?.compact_threshold ?? DEFAULT_MAX_TURNS;
  const keepRecent = opts.keepRecent ?? config.memory?.keep_recent ?? DEFAULT_KEEP_RECENT;
  const max_age_hours = opts.max_age_hours ?? 24;
  const messagesDir = opts.messagesDir || GLOBAL_MESSAGES_DIR;
  if (!chat_id) return { skipped: "no chat_id" };

  const records = readChatRecords({ channel, chat_id, max_age_hours, messagesDir });

  // Find the latest existing compact and what it already covers.
  let prevCompact = null;
  for (const m of records) if (m.type === "compact") prevCompact = m;
  const coverUntil = prevCompact ? prevCompact.meta?.covers_until_ts || prevCompact.ts : "";
  const prevCount = prevCompact ? prevCompact.meta?.count || 0 : 0;

  // Conversational turns not yet covered by a compact.
  const fresh = records.filter(
    (m) =>
      (m.type === "user" || m.type === "agent" || m.type === "tool") &&
      (!coverUntil || m.ts > coverUntil)
  );
  const realTurns = fresh.filter((m) => m.type === "user" || m.type === "agent");
  if (realTurns.length <= maxTurns) {
    return { skipped: "below threshold", turns: realTurns.length };
  }

  // Compact the oldest turns, leaving the most recent `keepRecent` real turns
  // verbatim. We compact everything (incl. interleaved tools) up to the ts of
  // the (realTurns.length - keepRecent)-th real turn.
  const boundaryReal = realTurns[realTurns.length - keepRecent - 1];
  const boundaryTs = boundaryReal.ts;
  const toCompact = fresh.filter((m) => m.ts <= boundaryTs);
  const compactedReal = toCompact.filter((m) => m.type === "user" || m.type === "agent").length;
  if (compactedReal === 0) return { skipped: "nothing to compact" };

  let transcript = toCompact.map(renderTurn).join("\n\n");
  if (prevCompact && String(prevCompact.body || "").trim()) {
    transcript =
      `[RESUMEN PREVIO]\n${String(prevCompact.body).trim()}\n\n---\n\n` + transcript;
  }

  const models = resolveCompactModels(config);
  const summary = await summarize({ transcript, models, config });
  if (!summary) {
    log(`memory: compaction for ${channel}/${chat_id} skipped — no model available`);
    return { skipped: "no model" };
  }

  const totalCovered = prevCount + compactedReal;
  appendGlobalMessage({
    channel,
    direction: "out",
    type: "compact",
    actor_id: "compact",
    actor_kind: "compact",
    author: "compact",
    body: summary.text,
    meta: {
      chat_id,
      compact: true,
      range: [1, totalCovered],
      count: totalCovered,
      covers_until_ts: boundaryTs,
      compacted_turns: compactedReal,
      model: summary.model,
    },
  });
  log(
    `memory: compacted ${compactedReal} turn(s) for ${channel}/${chat_id} via ${summary.model} (covers 1-${totalCovered})`
  );
  return { compacted: true, turns: compactedReal, covers: totalCovered, model: summary.model };
}
