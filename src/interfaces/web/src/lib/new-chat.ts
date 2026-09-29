import type { InboxRow } from "./api/inbox";

/**
 * Who you can start a new chat with: every agent ONCE.
 *
 * A new chat always opens a fresh web session, so the picker is a list of
 * agents, not of conversations. Fed the every-channel inbox, it listed the
 * super-agent once per channel it had spoken on — "Roby" four times, plus a
 * Discord "#general" row wearing its face (the owner, 2026-09-28). The sheet asks
 * the daemon for the web-scoped list, which already collapses to one row per
 * agent; this is the floor under that, so a list that ever carries a second
 * row for the same agent still shows it once. The first row wins: the daemon
 * sorts newest first.
 */
export function pickableAgents(rows: InboxRow[]): InboxRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (r.kind !== "agent" && r.kind !== "super_agent") return false;
    // The super-agent is one agent whatever project its thread was written in.
    const key = r.kind === "super_agent" ? "super_agent" : `${r.project_id}:${r.agent_slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
