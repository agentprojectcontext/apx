// Progressive history compaction (Pieza 3) — condenser v2.
//
// When a channel chat accumulates more than `maxTurns` (60) conversational
// turns in the rolling window, the oldest turns beyond `keepRecent` (40) are
// collapsed by a light LLM into a STRUCTURED STATE summary (OpenHands
// LLMSummarizingCondenser mechanics) and persisted as a `type:"compact"`
// record in the channel JSONL. Two condenser behaviors on top of the original
// narrative recap:
//   - previous-summary threading: the latest compact record (if any) is fed
//     into the prompt as the FIRST event so the new summary subsumes it —
//     state tracked across compactions never silently drops;
//   - keep_first: the conversation's opening turns (original goal) get special
//     treatment — see the keep_first comment in compactChannelIfNeeded.
//
// The reader (getRecentChannelTurnsFromFs) then prepends the summary as a
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
import {
  resolveCompactModels,
  buildCondenserPrompt,
  summarizeStructured,
} from "./summarizer.js";

// Re-export so existing importers (tests, callers) keep working.
export { resolveCompactModels };

const DEFAULT_MAX_TURNS = 60;
const DEFAULT_KEEP_RECENT = 40;
const DEFAULT_KEEP_FIRST = 2;

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

function renderEvent(m, id) {
  if (m.type === "tool") {
    const name = m.meta?.tool_name || m.meta?.tool || "tool";
    return `<EVENT id=${id} role=tool name=${name}>\n${String(m.body || "").slice(0, 600)}\n</EVENT>`;
  }
  const role = m.type === "user" ? "user" : "assistant";
  return `<EVENT id=${id} role=${role}>\n${String(m.body || "")}\n</EVENT>`;
}

// Compact one channel chat if it's over threshold. Returns a small status obj.
// opts: { channel, chat_id, config, log, maxTurns, keepRecent, keepFirst,
//         max_age_hours, messagesDir }  (messagesDir overridable for tests)
export async function compactChannelIfNeeded(opts = {}) {
  const channel = opts.channel || "telegram";
  const chat_id = opts.chat_id;
  const config = opts.config || {};
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const maxTurns = opts.maxTurns ?? config.memory?.compact_threshold ?? DEFAULT_MAX_TURNS;
  const keepRecent = opts.keepRecent ?? config.memory?.keep_recent ?? DEFAULT_KEEP_RECENT;
  const keepFirst = opts.keepFirst ?? config.memory?.keep_first ?? DEFAULT_KEEP_FIRST;
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

  // keep_first (OpenHands): the first K events of a conversation are never
  // condensed because they hold the original goal. Our JSONL model has a
  // single covers_until_ts boundary and the reader drops EVERYTHING at or
  // before it, so leaving those turns verbatim on disk reads would need a
  // second boundary plus an intrusive reader change. We take the documented
  // simplification instead: on the FIRST condensation (no previous compact —
  // i.e. these really are the conversation's opening turns) the first
  // `keepFirst` real turns are pulled out of the <EVENT> stream and quoted
  // verbatim in the prompt with an instruction to preserve the original goal
  // in USER_CONTEXT. On later condensations the goal already lives in the
  // threaded previous summary, so keep_first no longer applies.
  let openingTurns = [];
  let eventRecords = toCompact;
  if (!prevCompact && keepFirst > 0) {
    openingTurns = toCompact
      .filter((m) => m.type === "user" || m.type === "agent")
      .slice(0, keepFirst);
    const openingSet = new Set(openingTurns);
    eventRecords = toCompact.filter((m) => !openingSet.has(m));
  }

  // Previous-summary threading: the last summary rides along as the first
  // event so the new summary subsumes it (continuity across compactions).
  const events = [];
  if (prevCompact && String(prevCompact.body || "").trim()) {
    events.push(
      `<EVENT id=0 role=summary>\n[PREVIOUS STATE SUMMARY]\n${String(prevCompact.body).trim()}\n</EVENT>`
    );
  }
  for (const m of eventRecords) events.push(renderEvent(m, events.length));

  const prompt = buildCondenserPrompt({
    eventsBlock: events.join("\n\n"),
    openingBlock: openingTurns.map(renderTurn).join("\n\n"),
  });

  const models = resolveCompactModels(config);
  const summary = await summarizeStructured({ prompt, models, config });
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
      condenser: "v2",
      ...(prevCompact ? { prev_compact_ts: prevCompact.ts } : {}),
    },
  });
  log(
    `memory: compacted ${compactedReal} turn(s) for ${channel}/${chat_id} via ${summary.model} (covers 1-${totalCovered})`
  );
  return { compacted: true, turns: compactedReal, covers: totalCovered, model: summary.model };
}
