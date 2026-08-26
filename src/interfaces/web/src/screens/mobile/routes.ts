import type { ChatKey } from "../../components/chat/ChatList";
import type { InboxRow } from "../../lib/api/inbox";

/**
 * The phone surface in the URL.
 *
 *   /mobile                                  the chat list
 *   /mobile/team/:pid                        one project's team
 *   /mobile/chat/:pid/:slug                  a chat, on whatever it last used
 *   /mobile/chat/:pid/:slug/:session         a chat, on one specific session
 *
 * Navigation used to be `useState`, which meant a reload — or the phone
 * discarding the tab in the background, which it does constantly — dropped you
 * back on the list and lost the thread you were reading. Anything you can be
 * looking at has to be somewhere you can be sent back to.
 *
 * `~` separates a channel from a thread id because it is one of the handful of
 * characters a URL never has to escape (RFC 3986 unreserved), so the path stays
 * readable: /mobile/chat/0/roby/telegram~2026-08-19.
 */

export const MOBILE_ROOT = "/mobile";

/**
 * The daemon-level super-agent belongs to no project: its inbox row carries
 * `project_id: null`. Left as an empty string that becomes `/mobile/chat//roby`
 * — a path with an empty segment, which matches no route at all, so opening
 * Roby bounced straight back to the list.
 *
 * `-` and not `0`: zero is a REAL project id here, and a sentinel that collides
 * with live data is a bug waiting for the one user who has that project.
 */
const NO_PROJECT = "-";

/** The `:pid` segment for a row. */
export function pidOf(row: Pick<InboxRow, "project_id">): string {
  return row.project_id === null || row.project_id === undefined ? NO_PROJECT : String(row.project_id);
}

/** The project id a `:pid` segment stands for — null for the super-agent. */
export function projectOf(pid: string): number | string | null {
  return pid === NO_PROJECT ? null : pid;
}

/** The session segment for a selection, or null when it is just "the latest". */
export function sessionParam(key: ChatKey): string | null {
  if (key.kind === "thread") return `${key.channel}~${key.threadId}`;
  if (key.kind === "conv") return key.convId;
  return null;
}

/** Query string ChatTab writes for a selection (`/p/:pid/chat` and `/m/inbox`). */
export function queryForChat(key: ChatKey): URLSearchParams {
  const next = new URLSearchParams();
  if (key.kind === "conv") {
    next.set("agent", key.agentSlug);
    next.set("conv", key.convId);
  } else if (key.kind === "thread") {
    next.set("channel", key.channel);
    next.set("thread", key.threadId);
  } else {
    next.set("agent", key.agentSlug);
  }
  return next;
}

export function chatPath(pid: string, slug: string, key?: ChatKey): string {
  const base = `${MOBILE_ROOT}/chat/${encodeURIComponent(pid)}/${encodeURIComponent(slug)}`;
  const session = key ? sessionParam(key) : null;
  return session ? `${base}/${encodeURIComponent(session)}` : base;
}

export function teamPath(pid: string): string {
  return `${MOBILE_ROOT}/team/${encodeURIComponent(pid)}`;
}

/**
 * Where an agent's card / project view lives — the ficha (`AgentDetailScreen`)
 * for a project agent, the workspace chat for the super-agent (it has no project
 * ficha), and the pair thread for an a2a row. Shared so the inbox (self) and the
 * phone (new tab) send you to the same place.
 */
export function agentCardUrl(row: InboxRow): string {
  if (row.kind === "super_agent") return "/p/0/chat";
  const pid = row.project_id ?? 0;
  if (row.kind === "a2a" || row.kind === "group") {
    return `/p/${pid}/chat?channel=${row.kind}&thread=${encodeURIComponent(row.conversation_id || "")}`;
  }
  return `/p/${pid}/agents/${encodeURIComponent(row.agent_slug)}`;
}

/**
 * Where a row opens by default: the super-agent has channel threads, a project
 * agent has conversation files, and either can have neither yet.
 */
export function keyFor(row: InboxRow, sessionId?: string, channel?: string): ChatKey {
  // An a2a row is a conversation BETWEEN two agents, addressed as a thread on the
  // "a2a" channel — never one agent's conversation file (its agent_slug is the
  // synthetic "a2a:<pair>", which owns no file). Missing this made the phone open
  // a blank pane with the raw pair id in the header.
  if (row.kind === "a2a" || row.kind === "group") {
    const id = sessionId || row.conversation_id || "";
    return id ? { kind: "thread", channel: row.kind, threadId: id } : { kind: "live", agentSlug: row.agent_slug };
  }
  if (row.kind === "super_agent") {
    const ch = channel || row.channel || "web";
    const id = sessionId || row.conversation_id || "";
    return id ? { kind: "thread", channel: ch, threadId: id } : { kind: "live", agentSlug: row.agent_slug };
  }
  const id = sessionId || row.conversation_id || "";
  return id ? { kind: "conv", agentSlug: row.agent_slug, convId: id } : { kind: "live", agentSlug: row.agent_slug };
}

/**
 * Does this URL mean the person is already reading this inbox row?
 *
 * ChatTab addresses a session two ways: query (`?channel=&thread=` or
 * `?agent=&conv=`) on `/p/:pid/chat` and `/m/inbox`, and a path on the phone
 * (`/mobile/chat/:pid/:slug/:session`). Matching only `?agent=` missed groups
 * and the inbox — both write `channel`+`thread` and have no agent param.
 */
export function urlLooksAt(href: string, row: InboxRow): boolean {
  const url = new URL(href, "http://localhost");
  const key = keyFor(row);

  const mobile = url.pathname.match(/^\/mobile\/chat\/[^/]+\/([^/]+)(?:\/([^/]+))?/);
  if (mobile) {
    if (decodeURIComponent(mobile[1]) !== row.agent_slug) return false;
    if (!mobile[2]) return true;
    return decodeURIComponent(mobile[2]) === (sessionParam(key) ?? "");
  }

  const want = queryForChat(key);
  if (want.has("thread")) {
    return url.searchParams.get("channel") === want.get("channel")
      && url.searchParams.get("thread") === want.get("thread");
  }
  if (want.has("conv")) {
    return url.searchParams.get("agent") === want.get("agent")
      && url.searchParams.get("conv") === want.get("conv");
  }
  if (want.has("agent")) return url.searchParams.get("agent") === want.get("agent");
  return false;
}

/** The selection a URL asks for, falling back to the row's own default. */
export function selectionFromParam(param: string | undefined, row: InboxRow): ChatKey {
  // An a2a row has exactly one thread; there are no alternate sessions to pick,
  // so the pair thread is the selection regardless of any URL session segment.
  if (row.kind === "a2a" || row.kind === "group") return keyFor(row);
  if (!param) return keyFor(row);
  const raw = decodeURIComponent(param);
  if (row.kind === "super_agent") {
    const cut = raw.indexOf("~");
    // A thread with no channel in it is a URL from somewhere else (or hand
    // typed); fall back rather than building a selection that loads nothing.
    if (cut <= 0) return keyFor(row);
    return { kind: "thread", channel: raw.slice(0, cut), threadId: raw.slice(cut + 1) };
  }
  return { kind: "conv", agentSlug: row.agent_slug, convId: raw };
}

/**
 * A row for an agent the inbox does not list.
 *
 * Deep links outlive the inbox: it only carries agents that have been talked
 * to, and it is filtered and paged. Landing on a chat that is not in the list
 * should open the chat with the slug as its name, not bounce to the list —
 * being sent somewhere else is worse than a missing avatar.
 */
export function placeholderRow(pid: string, slug: string, known: InboxRow[]): InboxRow {
  // Whether this is the super-agent is decided by the inbox's own answer for
  // that slug when it has one, so this file never hardcodes its spelling.
  const sameSlug = known.find((r) => r.agent_slug === slug);
  const isGroup = slug.startsWith("group:");
  const isA2a = slug.startsWith("a2a:");
  const kind = sameSlug?.kind ?? (isGroup ? "group" : isA2a ? "a2a" : "agent");
  const conversation_id = isGroup
    ? slug.slice("group:".length)
    : isA2a
      ? slug.slice("a2a:".length)
      : null;
  return {
    project_id: projectOf(pid),
    project_name: null,
    project_path: null,
    agent_slug: slug,
    agent_name: sameSlug?.agent_name ?? null,
    agent_emoji: sameSlug?.agent_emoji ?? null,
    agent_icon: sameSlug?.agent_icon ?? null,
    kind,
    pinned: false,
    conversation_id: sameSlug?.conversation_id ?? conversation_id,
    channel: kind === "group" || kind === "a2a" ? kind : null,
    messages: 0,
    preview: null,
    last_activity_at: "",
  };
}

/** The row a /mobile/chat/:pid/:slug URL points at. */
export function findRow(rows: InboxRow[], pid: string, slug: string): InboxRow {
  const hit = rows.find((r) => pidOf(r) === pid && r.agent_slug === slug);
  return hit || placeholderRow(pid, slug, rows);
}
