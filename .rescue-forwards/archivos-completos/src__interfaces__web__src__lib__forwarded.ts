// A message carried in from another session, as the panel reads it.
//
// The daemon writes two halves of every forward: the MARKER, folded into the
// turn's text so the model reads the quote (core/stores/forwards.js), and the
// META, recorded on the row so a surface can draw the quote as a card instead.
// This file is the reader's half — the shape, the strip, and the one sentence
// that says where it came from.
//
// The regex below is a COPY of `FORWARD_MARKER_RE` in core/stores/forwards.js,
// for the same reason `DELIVERED_CHANNELS` is copied into lib/channels.ts: the
// panel is a separate workspace and cannot import from core. The two are held
// together by `tests/forwards.test.js`, which builds a marker with the real
// builder and strips it with the regex read out of THIS file — so a change to
// one that the other does not follow fails the suite rather than putting
// machine-facing prose in the middle of somebody's conversation.
import { channelLabel } from "./channels";

/** Where a forwarded message came from — the same address the sidebar uses, so
 *  the card can offer the way back to the rest of that conversation. */
export interface ForwardSource {
  kind: "thread" | "conv" | "live";
  channel?: string;
  thread_id?: string;
  agent_slug?: string;
  conversation_id?: string;
  /** What that session is CALLED. The day/ids name an address, not a chat. */
  title?: string;
}

export interface Forwarded {
  from: ForwardSource;
  /** Whose words these are: the owner's, or an agent's. */
  author: "user" | "agent";
  /** The agent's display name, when an agent said it. */
  author_name?: string;
  text: string;
  ts?: string;
  /** The original was longer than the quote cap and was cut. */
  truncated?: boolean;
}

const MARKER = /^\[forwarded message[^\]]*\]\n[\s\S]*?\[end of forwarded message\]\n*/;

/** What the person actually wrote, with the machine-facing quote block taken
 *  out. The quote is not lost — it is drawn from `msg.forwarded` as a card. */
export function stripForwardMarker(text: string): string {
  return String(text ?? "").replace(MARKER, "").trim();
}

/** The source, in words: a session title when it has one, else the channel it
 *  lives on. Never a bare id — "2026-09-17" names a day, not a conversation. */
export function forwardSourceLabel(fwd: Forwarded): string {
  const from = fwd.from || ({} as ForwardSource);
  if (from.title) return from.title;
  if (from.channel) return channelLabel(from.channel);
  return from.agent_slug || "";
}
