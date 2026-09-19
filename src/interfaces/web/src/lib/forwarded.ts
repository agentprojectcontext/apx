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
import { channelLabel, DELIVERED_CHANNELS } from "./channels";
// Type-only: the address a chat is reached by. Erased at build time, so this
// stays a rule about addresses rather than a dependency on the component that
// happens to declare their shape.
import type { ChatKey } from "../components/chat/ChatList";
import { threadDate } from "./thread-id";

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
  /** WHICH PROJECT it was said in. A forward crosses projects now, and without
   *  this the card's way back would open the same address in the wrong one. */
  project_id?: string;
  project_name?: string;
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

/**
 * May this session RECEIVE a forward?
 *
 * Four noes, and every one of them is the same no: the message would not land
 * where the list said it would.
 *
 *   - a delivered channel (Telegram, WhatsApp) — the thread is a receipt for
 *     something already on somebody's phone, and a turn written there goes out
 *     on `web` instead;
 *   - a2a — the record of two agents talking, which the daemon refuses to be
 *     written into (`rejectA2AWrite`);
 *   - a group room — its turns go out through the cascade endpoint, which
 *     carries no quote, so the forward would arrive as a bare note about a
 *     message nobody in the room can see;
 *   - the conversation the message is already in — forwarding a message to
 *     itself is a no-op dressed as an action.
 *
 * And one more, which is the same no wearing a date. The super-agent has no
 * conversation file: its threads ARE the channel and the day, and a turn sent
 * from this pane is written with the clock, onto this pane's own surface. So
 * yesterday's thread, or one belonging to another surface (desktop, code), can
 * be OPENED here but not continued — a forward dropped into it would be shown
 * in one thread and recorded in another, which is precisely the bug that made
 * replies typed into a Telegram thread disappear on the next reload. Same
 * reasoning as `threadRewindRefusal` in core/constants/channels.js, and the
 * same two conditions.
 *
 * Archived sessions are left out too: reaching for one is a decision to take it
 * back out of the drawer, not something a send should do on your behalf.
 */
export function canReceiveForward(
  session: { channel?: string; archived?: boolean; key: ChatKey },
  origin?: ChatKey,
  /** The channel this pane's own turns go out on, and the day it is writing —
   *  both injectable so the rule can be tested without a clock. */
  opts: { surface?: string; today?: string } = {},
): boolean {
  if (session.channel && DELIVERED_CHANNELS.has(session.channel)) return false;
  if (session.channel === "a2a" || session.channel === "group") return false;
  if (session.archived) return false;
  if (session.key.kind === "thread") {
    const surface = opts.surface || "web";
    // UTC, the same clock the daemon mints thread ids with — or the two
    // disagree for the three hours a day the local date is already tomorrow.
    const today = opts.today || new Date().toISOString().slice(0, 10);
    if (session.key.channel !== surface) return false;
    if (threadDate(session.key.threadId) !== today) return false;
  }
  if (!origin) return true;
  if (origin.kind === "thread" && session.key.kind === "thread") {
    return !(origin.channel === session.key.channel && origin.threadId === session.key.threadId);
  }
  if (origin.kind === "conv" && session.key.kind === "conv") {
    return !(origin.agentSlug === session.key.agentSlug && origin.convId === session.key.convId);
  }
  return true;
}

/** The source, in words, FOR A READER: a session title when it has one, else
 *  the channel it lives on, spelled the way the rest of the panel spells it.
 *  Never a bare id — "2026-09-17" names a day, not a conversation. */
export function forwardSourceLabel(fwd: Forwarded): string {
  const from = fwd.from || ({} as ForwardSource);
  if (from.title) return from.title;
  if (from.channel) return channelLabel(from.channel);
  return from.agent_slug || "";
}

/** The same source FOR THE MODEL — the raw channel name, not the panel's label
 *  for it. It mirrors `forwardSourceLabel` in core/stores/forwards.js, which is
 *  what actually writes the stored marker; a translated word here would make
 *  the two disagree the moment the reader's locale changed. */
function markerSourceLabel(fwd: Forwarded): string {
  const from = fwd.from || ({} as ForwardSource);
  return from.title || from.channel || from.agent_slug || "web";
}

/**
 * The quote as the MODEL reads it — a copy of `forwardMarker` in
 * core/stores/forwards.js, pinned to it by `tests/forwards.test.js`.
 *
 * The panel needs its own because of HISTORY. A turn sent from this pane is in
 * the pane's memory before it is on disk, and the next turn's `previousMessages`
 * is built from that memory: without this, the message after a forward would
 * reach the model with the note ("¿qué opinás?") and no sign of what it was
 * about. It is not used for what is STORED — the daemon writes that, from its
 * own normalised copy — so the two can only ever differ cosmetically, and the
 * test is there so they do not differ at all.
 */
export function forwardMarker(fwd: Forwarded): string {
  const who = fwd.author === "user" ? "the owner" : fwd.author_name || "an agent";
  const when = fwd.ts ? fwd.ts.replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC") : "";
  const head = [
    `from ${markerSourceLabel(fwd)}`,
    `said by ${who}`,
    when ? `on ${when}` : "",
  ].filter(Boolean).join(", ");
  const quoted = fwd.text.split("\n").map((line) => `> ${line}`).join("\n");
  return `[forwarded message — ${head}]\n${quoted}\n[end of forwarded message]`;
}

// ── Who a message can be handed to ──────────────────────────────────────────

/** One row of `GET /api/agents/directory`: every agent this install has, with
 *  the project it belongs to. */
export interface DirectoryAgent {
  project_id: string;
  project_name: string;
  slug: string;
  name?: string | null;
  icon?: string | null;
  emoji?: string | null;
  role?: string | null;
}

export interface ForwardPerson {
  slug: string;
  name: string;
  icon?: string | null;
  emoji?: string | null;
  /** The project this agent lives in. Absent for the super-agent, which belongs
   *  to the daemon rather than to any one project. */
  projectId?: string;
  projectName?: string;
  isSuper?: boolean;
}

/** People under a heading: the project they are in, or the one the reader is
 *  standing in (which gets no heading — it is where they already are). */
export interface ForwardGroup {
  key: string;
  label: string;
  people: ForwardPerson[];
}

/** Lowercase, and without the accents. Searching "magui" has to find "Maguí",
 *  and searching "cañada" has to find it back — a picker that only matches what
 *  you can type exactly is a picker you fight. */
function fold(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Everybody a message can be forwarded to, grouped and filtered.
 *
 * `total` is the count BEFORE the query, and that is the whole point of
 * returning it: the search field's visibility must be decided by how many
 * people exist, never by how many the current query matched. Deciding it from
 * the filtered list is what made the field disappear the moment you mistyped a
 * name — taking with it the only way to fix the typo.
 */
export function forwardPeople({
  pid,
  superAgent,
  here,
  directory = [],
  query = "",
}: {
  pid: string;
  superAgent: ForwardPerson;
  /** The current project's agents, as the chat screen already has them. */
  here: { slug: string; name?: string | null; icon?: string | null; emoji?: string | null }[];
  /** Every agent of every project. The current project's are skipped — `here`
   *  is the same list, already loaded, and two copies would draw two rows. */
  directory?: DirectoryAgent[];
  query?: string;
}): { groups: ForwardGroup[]; total: number } {
  const mine: ForwardPerson[] = [
    { ...superAgent, isSuper: true },
    ...here.map((a) => ({ slug: a.slug, name: a.name || a.slug, icon: a.icon, emoji: a.emoji })),
  ];
  const elsewhere = new Map<string, ForwardGroup>();
  for (const a of directory) {
    if (String(a.project_id) === String(pid)) continue;
    const key = String(a.project_id);
    if (!elsewhere.has(key)) elsewhere.set(key, { key, label: a.project_name || key, people: [] });
    elsewhere.get(key)!.people.push({
      slug: a.slug,
      name: a.name || a.slug,
      icon: a.icon,
      emoji: a.emoji,
      projectId: key,
      projectName: a.project_name || "",
    });
  }

  const others = [...elsewhere.values()].sort((a, b) => a.label.localeCompare(b.label));
  const total = mine.length + others.reduce((n, g) => n + g.people.length, 0);

  const q = fold(query.trim());
  if (!q) {
    return { groups: [{ key: "here", label: "", people: mine }, ...others], total };
  }
  // The project's NAME matches too: "apx" is a perfectly good way to ask for
  // the people in apx, and it is often the only half you remember.
  const hit = (p: ForwardPerson, projectLabel = "") =>
    fold(`${p.name} ${p.slug} ${projectLabel}`).includes(q);
  const groups = [
    { key: "here", label: "", people: mine.filter((p) => hit(p)) },
    ...others.map((g) => ({ ...g, people: g.people.filter((p) => hit(p, g.label)) })),
  ].filter((g) => g.people.length);
  return { groups, total };
}
