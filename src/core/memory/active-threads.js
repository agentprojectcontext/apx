// "Active threads on other channels" — a tiny, recency-based awareness block.
//
// Unlike the Memory Broker (semantic RAG + remembered notes), this reads the
// raw cross-channel message log and surfaces the most recent turn from every
// channel OTHER than the one the user is on right now, within a short window.
// It fills the gap where a vague "seguimos?" on the web wouldn't semantically
// match the deploy thread you had on Telegram 12 minutes ago.
//
// Bounded + best-effort: only appears when there's recent cross-channel
// activity, capped at max_lines bullets. Never throws into the request path.

import fs from "node:fs";
import path from "node:path";
import { GLOBAL_MESSAGES_DIR } from "../config.js";
import { parseDayJsonl } from "../stores/messages.js";

const BODY_CAP = 70;

function ago(ts) {
  const then = Date.parse(ts);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} h ago`;
}

// Prefer the last USER turn (most recognizable for "lo de antes"); fall back to
// the last agent turn. Skip tool/system/compact noise and tiny bodies.
function lastMeaningfulTurn(records) {
  const pick = (pred) => {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (!r || r.type === "tool" || r.type === "system" || r.type === "compact") continue;
      if (!pred(r)) continue;
      const body = String(r.body || "").trim();
      if (body.length >= 4) return r;
    }
    return null;
  };
  return (
    pick((r) => r.type === "user" || r.direction === "in") ||
    pick(() => true)
  );
}

function readChannelRecentTurn(baseDir, channel, sinceMs) {
  const dir = path.join(baseDir, channel);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return null;
  }
  if (!files.length) return null;
  // Last 2 day files cover a window that crosses midnight without reading all.
  let records = [];
  for (const f of files.slice(-2)) {
    try {
      records = records.concat(parseDayJsonl(fs.readFileSync(path.join(dir, f), "utf8")));
    } catch {
      /* skip bad file */
    }
  }
  const turn = lastMeaningfulTurn(records);
  if (!turn) return null;
  const t = Date.parse(turn.ts);
  if (!Number.isFinite(t) || t < sinceMs) return null;
  return turn;
}

// Build the "# Active threads on other channels" block. Returns "" when there's
// nothing recent on another channel (or the feature is disabled).
export function buildActiveThreadsBlock(currentChannel, { config, messagesDir } = {}) {
  try {
    const cfg = config?.memory?.active_threads || {};
    if (cfg.enabled === false) return "";
    const windowHours = cfg.window_hours || 6;
    const maxLines = cfg.max_lines || 3;
    const sinceMs = Date.now() - windowHours * 3600_000;
    const baseDir = messagesDir || GLOBAL_MESSAGES_DIR;

    let channels;
    try {
      channels = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return "";
    }

    const cur = String(currentChannel || "");
    const rows = [];
    for (const ch of channels) {
      if (ch === cur) continue;
      const turn = readChannelRecentTurn(baseDir, ch, sinceMs);
      if (!turn) continue;
      rows.push({
        channel: ch,
        ts: turn.ts,
        body: String(turn.body || "").replace(/\s+/g, " ").trim(),
      });
    }
    if (!rows.length) return "";
    rows.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

    const lines = rows.slice(0, maxLines).map((r) => {
      const body = r.body.length > BODY_CAP ? r.body.slice(0, BODY_CAP - 1).trimEnd() + "…" : r.body;
      return `• ${r.channel} — ${ago(r.ts)}: "${body}"`;
    });

    return [
      "# Active threads on other channels",
      "Recent chatter on other surfaces (NOT this chat). If the user says",
      '"let\'s continue" / "the thing from before" / "the telegram one" it\'s probably',
      "one of these — pick it up naturally; use search_messages for exact detail.",
      "",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
}
