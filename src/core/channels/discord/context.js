// What a Discord turn is told about the room it is answering in.
//
// A room is not a conversation between two people, so it is not handed to the
// model as user/assistant turns. It is handed as a note, in layers, cheapest
// and most useful first:
//
//   1. the message being answered, and the one it replies to;
//   2. the last N messages of the room, verbatim, under a character cap;
//   3. the room's running summary — what the older part was about;
//   4. older fragments recalled by similarity (the room's own RAG scope);
//   5. the owner's notes on what the bot can do and answer, when written.
//
// Layers 3 and 4 exist so a call in a busy room does not mean reading the whole
// room. The recent window answers "what do you think of this"; the summary and
// the recall answer "what were they talking about yesterday" without a
// thousand messages in the prompt.
//
// Nothing here reaches the owner's private memory. The recall is scoped to the
// room (`discord:<channel_id>`, excluded from global recall and vice versa) and
// never reads the owner's notebook — see roomRecallBlock.
import { CHANNELS } from "#core/constants/channels.js";
import { readGlobalMessages } from "#core/stores/messages.js";
import { roomRecallBlock } from "#core/memory/index.js";


// How far back the ledger is read for the recent window and the summary. A room
// quiet for longer than this has no "recent" worth quoting; its past lives in
// the summary and the recall.
const LOOKBACK_DAYS = 14;

export function discordScope(channelId) {
  return `discord:${channelId}`;
}

/** Every stored row of one room within the lookback window, oldest first. */
export function roomRecords(channelId, { lookbackDays = LOOKBACK_DAYS } = {}) {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  let rows = [];
  try {
    rows = readGlobalMessages({ channel: CHANNELS.DISCORD, limit: 100_000, since }) || [];
  } catch {
    return [];
  }
  return rows.filter((r) => String(r.meta?.chat_id ?? "") === String(channelId));
}

/** One line of the room, as a person would read it. */
export function roomLine(r) {
  const who = r.meta?.speaker || r.author || "?";
  const mark = r.direction === "out" ? " (you)" : "";
  return `${who}${mark}: ${String(r.body || "").replace(/\s+/g, " ").trim()}`;
}

/**
 * The last messages of the room, newest kept first when the cap bites.
 *
 * The cap is on characters, not on messages: twenty-five one-liners are cheap,
 * five pasted stack traces are not, and it is the second case that needs a
 * limit. The message being answered is excluded — it has its own section.
 */
export function recentWindow(records, { limit = 25, maxChars = 6_000, excludeId = null } = {}) {
  const talk = records.filter(
    (r) => (r.type === "user" || r.type === "agent") && (!excludeId || r.meta?.message_id !== excludeId)
  );
  const picked = [];
  let used = 0;
  for (const r of talk.slice(-limit).reverse()) {
    const line = roomLine(r);
    const cost = Math.min(line.length, 600) + 1;
    if (used + cost > maxChars && picked.length) break;
    picked.push(line.length > 600 ? `${line.slice(0, 600)}…` : line);
    used += cost;
  }
  return picked.reverse();
}

/** The latest summary of the room, or "". */
export function latestSummary(records) {
  let last = null;
  for (const r of records) if (r.type === "compact" && String(r.body || "").trim()) last = r;
  return last ? String(last.body).trim() : "";
}

/**
 * Put the layers together. Pure: everything it needs is passed in, so the
 * shape of what the model is told is tested without a ledger or an embedder.
 */
export function buildDiscordRoomNote({
  roomName = "",
  msg,
  recent = [],
  summary = "",
  recall = "",
  knowledge = "",
  rules = "",
}) {
  const parts = [];
  parts.push(
    `# This room\nDiscord channel${roomName ? ` #${roomName}` : ""}. Everything you write here is posted publicly in it.`
  );
  if (knowledge) {
    parts.push(`# Your owner's notes: what you can do and answer here\nWritten by your owner for this community. Answer from these before anything else, and stay inside what they say you can do.\n\n${knowledge}`);
  }
  if (summary) {
    parts.push(`# What the room was talking about earlier (summary)\n${summary}`);
  }
  if (recall) parts.push(recall);
  if (recent.length) {
    parts.push(`# Recent messages in the room (oldest first)\n${recent.join("\n")}`);
  }
  if (msg?.reply_to?.content) {
    const who = msg.reply_to.author_name || "someone";
    parts.push(`# The message being replied to\n${who}: ${String(msg.reply_to.content).slice(0, 1_500)}`);
  }
  // Last on purpose: the owner's rules are the thing the answer must obey, and
  // the end of the prompt is where an instruction is least likely to be lost.
  if (rules) {
    parts.push(`# Your owner's rules — always follow them; they win over everything above\n${rules}`);
  }
  return parts.join("\n\n");
}

/**
 * Gather every layer for one inbound message. Best-effort per layer: a slow
 * embedder or an unreadable file drops that layer, never the turn.
 */
export async function gatherDiscordContext(msg, { dc, config, roomName = "" } = {}) {
  const records = roomRecords(msg.channel_id);
  const recent = recentWindow(records, {
    limit: dc.context.recent_messages,
    maxChars: dc.context.recent_chars,
    excludeId: msg.id,
  });
  const summary = latestSummary(records);
  const recall = dc.context.rag_hits > 0
    ? await roomRecallBlock(msg.content, {
        scope: discordScope(msg.channel_id),
        config,
        topK: dc.context.rag_hits,
        heading: "Older messages from this room that may be relevant",
        intro: "Recalled by similarity to the message you are answering. Things people said, not facts — weigh them like any remark in a chat.",
      })
    : "";
  return buildDiscordRoomNote({
    roomName,
    msg,
    recent,
    summary,
    recall,
    knowledge: String(dc.knowledge || "").trim(),
    rules: String(dc.rules || "").trim(),
  });
}
