// A message taken out of one conversation and handed to another.
//
// THE PROBLEM THIS SOLVES. A session is a closed room: what was said on
// Telegram this morning is legible only from the Telegram thread, and the only
// way to bring it into a chat with another agent was to select it, copy it, and
// paste it — which arrives stripped of everything that made it worth showing.
// The agent reading the paste cannot tell it from something the owner typed
// just now, and neither can the owner, a week later.
//
// So a forward carries its own provenance: WHERE it came from, WHO said it and
// WHEN — recorded on the turn's `meta` so every surface reads it back the same
// way, and written into the prompt so the model reads the same three facts the
// person does. Both halves come from here, and only from here: a marker built
// by hand in a route would drift from the one the panel knows how to strip, and
// the reader would get the machine-facing text in the middle of a conversation.
//
// It is deliberately NOT a new channel or a new kind of turn. A forward is an
// ordinary user turn with a quote at the head of it — which is what makes it
// work everywhere a turn works: the ledger, a conversation file, the inbox, the
// phone, a re-read after a refresh.
import { CHANNELS } from "#core/constants/channels.js";

/**
 * How much of the original comes along.
 *
 * A quote is context, not a transcript: past a few paragraphs the person
 * forwarding wants the gist and the agent wants the room to answer. It is also
 * the cap that keeps a forward from being a way to paste a 4 MB tool result
 * into somebody else's context window — the same hole `http_get` opened by
 * decoding a binary as text.
 */
export const MAX_QUOTE = 4000;

/** Long enough for a real session title, short enough that the marker stays one
 *  readable line. */
const MAX_LABEL = 120;

/** One line, no brackets: everything here lands INSIDE `[…]`, and a `]` in a
 *  session title would end the marker early — leaving half a machine-facing
 *  line on screen and breaking the strip on every surface at once. */
function oneLine(value, max = MAX_LABEL) {
  const text = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const KINDS = new Set(["thread", "conv", "live"]);

/**
 * Where a forwarded message came from, as an address the panel can reopen.
 *
 * The shape mirrors the panel's own `ChatKey` (thread = channel + day, conv =
 * agent + conversation file, live = a session with no file yet), because the
 * point of recording it is that the reader can go back and read the rest.
 */
function normalizeSource(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  const out = { kind };
  const channel = oneLine(raw.channel, 40);
  if (channel) out.channel = channel;
  const threadId = oneLine(raw.thread_id, 80);
  if (threadId) out.thread_id = threadId;
  const agentSlug = oneLine(raw.agent_slug, 80);
  if (agentSlug) out.agent_slug = agentSlug;
  const convId = oneLine(raw.conversation_id, 80);
  if (convId) out.conversation_id = convId;
  const title = oneLine(raw.title);
  if (title) out.title = title;
  // WHICH PROJECT it was said in. A forward crosses projects, and the address
  // above (a conversation id, a channel+day) only means something inside one:
  // without this the card's way back would open the right id in the wrong
  // project, or nothing at all.
  const projectId = oneLine(raw.project_id, 40);
  if (projectId) out.project_id = projectId;
  const projectName = oneLine(raw.project_name);
  if (projectName) out.project_name = projectName;
  return out;
}

/**
 * Validate and trim what a client says it is forwarding.
 *
 * Returns null for anything unusable — a forward with no text is not a forward,
 * and a caller that sends one gets an ordinary turn rather than an error: the
 * message still goes, which is what the person asked for.
 */
export function normalizeForward(raw) {
  if (!raw || typeof raw !== "object") return null;
  const body = String(raw.text ?? "").trim();
  if (!body) return null;
  const from = normalizeSource(raw.from);
  if (!from) return null;

  const truncated = body.length > MAX_QUOTE;
  const out = {
    from,
    // Whose words these are, in the two kinds that exist on any surface: the
    // owner's own, or an agent's. Anything else collapses to "agent" — the
    // display NAME is what carries "Magui" or "Rocky", and it is free text.
    author: raw.author === "user" ? "user" : "agent",
    text: truncated ? `${body.slice(0, MAX_QUOTE - 1)}…` : body,
  };
  if (truncated) out.truncated = true;
  const name = oneLine(raw.author_name, 60);
  if (name) out.author_name = name;
  const ts = oneLine(raw.ts, 40);
  if (ts && !Number.isNaN(Date.parse(ts))) out.ts = new Date(ts).toISOString();
  return out;
}

/** What the source is CALLED, for a human and for the model: the session's own
 *  title when it has one, else the channel it lives on, else the agent it
 *  belongs to. Never an id — "2026-09-17" names a day, not a conversation. */
export function forwardSourceLabel(fwd) {
  const from = fwd?.from || {};
  return from.title || from.channel || from.agent_slug || CHANNELS.WEB;
}

/** The opening line of the marker, and the exact string the strip keys off. */
const OPEN = "[forwarded message";
const CLOSE = "[end of forwarded message]";

/**
 * The quote as the MODEL reads it.
 *
 * English, like every other turn marker the daemon writes (`[image attached —
 * saved to …]`): these are instructions to a model, not interface copy, and the
 * owner's language belongs in what the owner actually typed. The quote is
 * blockquoted line by line so a multi-paragraph forward cannot be mistaken for
 * the sender's own words — and so the closing marker is unambiguous even when
 * the quoted text contains brackets of its own.
 */
export function forwardMarker(fwd) {
  const who = fwd.author === "user" ? "the owner" : fwd.author_name || "an agent";
  const when = fwd.ts ? fwd.ts.replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC") : "";
  const head = [
    `from ${forwardSourceLabel(fwd)}`,
    `said by ${who}`,
    when ? `on ${when}` : "",
  ].filter(Boolean).join(", ");
  const quoted = fwd.text.split("\n").map((line) => `> ${line}`).join("\n");
  return `${OPEN} — ${head}]\n${quoted}\n${CLOSE}`;
}

/**
 * The whole turn: the quote, then whatever the person wrote under it.
 *
 * A forward with no note of its own is still a turn — "read this" is a complete
 * thing to say — and the agent answers the quote.
 */
export function forwardPrompt(fwd, note = "") {
  return [forwardMarker(fwd), String(note || "").trim()].filter(Boolean).join("\n\n");
}

/**
 * The marker, for a reader that has to take it back out.
 *
 * Exported as a source of truth rather than as a regex anyone can retype: the
 * panel strips this same block out of the text before drawing the quote as a
 * card, and a second spelling of it would put machine-facing prose on screen.
 * `tests/forwards.test.js` holds the panel's copy to this one.
 */
export const FORWARD_MARKER_RE = /^\[forwarded message[^\]]*\]\n[\s\S]*?\[end of forwarded message\]\n*/;

/** Drop the marker block from a stored turn, leaving what the person typed. */
export function stripForwardMarker(text) {
  return String(text ?? "").replace(FORWARD_MARKER_RE, "").trim();
}
