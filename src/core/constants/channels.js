// Channel names — kept in one place so a typo can't silently route the wrong
// prompt or skip a logging path. Each value is the exact string the daemon
// expects in `channel:` fields of API requests, message records, and
// CHANNEL_PROMPT_FILES keys.
//
// Channels are SURFACES (where the user is). Voice is NOT a channel — it's a
// MODE that layers on top of a surface via channelMeta.voice.
export const CHANNELS = Object.freeze({
  TELEGRAM: "telegram",
  CLI: "cli",
  ROUTINE: "routine",
  API: "api",
  WEB: "web",                 // Web admin big chat
  WEB_SIDEBAR: "web_sidebar", // Web admin docked sidebar
  WEB_CODE: "web_code",       // Web admin `/code` (OpenCode-style)
  DECK: "deck",               // Mobile cockpit dashboard
  DESKTOP: "desktop",         // Electron capsule (always voice mode)
  CODE: "code",               // `apx code` — terminal coding session
  // A launched runtime session (Claude Code, Codex, OpenCode…) as a room of
  // its own. A ROOM, not a day of a channel: one thread per session, addressed
  // by its id, so it lists in the chat list and can be written to. Manu asked
  // for it by name on 2026-09-20 — "un canal tipo runtime así sabés que es
  // aparte" — and apart is right: `code` is a terminal session the owner is
  // sitting in, this is a process somebody launched that is still running.
  RUNTIME: "runtime",
  A2A: "a2a",                 // Agent-to-agent relay (project-scoped ledger)
  LOG: "log",                 // Readable, never delivered (routine abstentions)
  DIRECT: "direct",           // Planned: 1:1 channel that isn't a chat platform
  WHATSAPP: "whatsapp",       // Planned: WhatsApp bot integration
});

/**
 * Channels whose turns were DELIVERED to a person on somebody else's platform.
 *
 * A row here is a receipt. The message is on their phone, in their app, and
 * nothing this daemon does can take it back — so rewriting the ledger would
 * only make our record disagree with what the other side is still reading. A
 * rewind (regenerate / edit & resend) is therefore refused on these, and the
 * panel does not offer it.
 *
 * `log` is deliberately NOT here: it exists precisely because it is readable
 * and never delivered.
 */
export const DELIVERED_CHANNELS = Object.freeze(
  new Set([CHANNELS.TELEGRAM, CHANNELS.WHATSAPP]),
);

/** Threads that are a ROOM inside a channel rather than a day of one. They are
 *  project-scoped ledgers with their own rewind (a group) or a deliberate
 *  refusal to have one (a2a: it is the record of two agents talking). Either
 *  way they never take the channel+day path. */
const ROOM_CHANNELS = Object.freeze(new Set([CHANNELS.A2A, "group", CHANNELS.RUNTIME]));

/**
 * May the panel rewind this channel+day thread — i.e. offer "regenerate" and
 * "edit & resend" on it?
 *
 * All three conditions are really one question: does the RE-SENT turn land back
 * where the one we just dropped was?
 *
 *   - not a delivered channel — see DELIVERED_CHANNELS;
 *   - not a room — those have their own endpoints;
 *   - TODAY. The re-run is written with the clock, into `channel/<today>.jsonl`
 *     (api/super-agent.js mints `thread_id` from `new Date()`), so rewinding
 *     Tuesday would cut a hole in Tuesday and put the answer in today's file.
 *
 * Returns a reason string when it refuses, so the caller can say WHICH of the
 * three it was rather than a bare "no".
 */
export function threadRewindRefusal(channel, threadId, today = new Date().toISOString().slice(0, 10)) {
  const ch = String(channel || "");
  if (ROOM_CHANNELS.has(ch)) return `${ch} threads are not rewound here`;
  if (DELIVERED_CHANNELS.has(ch)) return `${ch} messages were delivered and cannot be rewound`;
  // The id may name a person inside the day (`2026-09-18~5491122334455`); the
  // day is its first ten characters either way.
  if (String(threadId || "").slice(0, 10) !== today) return "only today's thread can be rewound";
  return null;
}
