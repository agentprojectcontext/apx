// The agent inbox — every agent as a conversation, most recent first.
//
// APX is navigated project-first: pick a project, then a tab, then an agent.
// The inbox inverts that. The unit becomes the CONVERSATION WITH AN AGENT and
// the project becomes an attribute of it, which is what someone running several
// projects at once actually wants as a daily entry point.
//
// It is a second axis, NOT a replacement. Project-first navigation stays intact
// — projects as a first-class unit with versioned context is what APX has that
// a personal assistant does not, and the inbox must not erode it.
//
// Same shape as listTasksAcrossProjects in stores/tasks.js, for the same
// reasons: the caller supplies the project list so core stays free of daemon
// imports, an unreadable project is skipped and named rather than fatal, and
// ordering has a deterministic tiebreak because nowIso() only has second
// resolution.
import { readAgents } from "../apc/parser.js";
import { listConversations } from "./conversations.js";
import { listGlobalThreads, readGlobalThread } from "./messages.js";
import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";

/** Most recent first; slug breaks ties so two identical calls agree. */
function byRecency(a, b) {
  const t = (b.last_activity_at || "").localeCompare(a.last_activity_at || "");
  if (t !== 0) return t;
  return String(a.agent_slug || "").localeCompare(String(b.agent_slug || ""));
}

/**
 * One row per agent that has a conversation, plus the super-agent.
 *
 * @param {{id:any, name?:string, path?:string, storagePath:string}[]} projects
 * @param {object} opts
 *   - limit          cap applied AFTER the merge
 *   - includeEmpty   also list agents that have never been talked to
 * @returns {{ rows: object[], skipped: {id:any, error:string}[] }}
 */
export function listAgentInbox(projects, opts = {}) {
  const { limit, includeEmpty = false } = opts || {};
  const rows = [];
  const skipped = [];

  for (const entry of projects || []) {
    if (!entry?.storagePath) continue;
    const projectMeta = {
      project_id: entry.id,
      project_name: entry.name || entry.path || String(entry.id),
      project_path: entry.path || null,
    };

    let agents = [];
    try {
      agents = entry.path ? readAgents(entry.path) : [];
    } catch (e) {
      skipped.push({ id: entry.id, error: e?.message || String(e) });
      continue;
    }

    for (const agent of agents) {
      let conversations = [];
      try {
        conversations = listConversations(entry.storagePath, agent.slug);
      } catch {
        // One agent's unreadable conversation directory must not drop the
        // whole project from the inbox.
        conversations = [];
      }
      const latest = conversations[0] || null;
      if (!latest && !includeEmpty) continue;

      rows.push({
        ...projectMeta,
        agent_slug: agent.slug,
        agent_name: agent.fields?.Name || agent.name || agent.slug,
        agent_emoji: agent.fields?.Emoji || agent.emoji || null,
        agent_icon: agent.fields?.Icon || agent.icon || null,
        kind: "agent",
        pinned: false,
        conversation_id: latest?.id || null,
        channel: latest?.channel || null,
        messages: latest?.messages || 0,
        // The agent's last REPLY, not the user's last prompt.
        preview: latest?.preview || null,
        last_activity_at: latest?.last_turn_at || latest?.started_at || "",
      });
    }
  }

  rows.sort(byRecency);

  // The super-agent is the single voice the owner talks to and the others
  // report through it. It is pinned first and marked distinct so the hierarchy
  // is visible, rather than sorted in among its own reports.
  const superRow = buildSuperAgentRow();
  const out = superRow ? [superRow, ...rows] : rows;

  return {
    rows: Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out,
    skipped,
  };
}

/**
 * The pinned super-agent row.
 *
 * The super-agent does NOT keep per-agent conversation files the way project
 * agents do — it talks on channels, and its history is the cross-channel ledger
 * (~/.apx/messages/<channel>/YYYY-MM-DD.jsonl). So recency and the preview come
 * from there, not from agents/<slug>/conversations.
 */
function buildSuperAgentRow() {
  let threads = [];
  try {
    threads = listGlobalThreads();
  } catch {
    threads = [];
  }

  const messages = threads.reduce((n, t) => n + (t.messages || 0), 0);
  const latest = threads[0] || null; // listGlobalThreads sorts by last_ts desc

  let preview = null;
  if (latest) {
    try {
      const thread = readGlobalThread({ channel: latest.channel, date: latest.id });
      const lastReply = [...(thread?.messages || [])]
        .reverse()
        .find((m) => m.role === "assistant");
      preview = (lastReply?.content || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160) || null;
    } catch {
      preview = null;
    }
  }

  return {
    project_id: null,
    project_name: null,
    project_path: null,
    agent_slug: SUPERAGENT_ACTOR_ID,
    agent_name: null, // resolved by the surface via resolveAgentName()
    agent_emoji: null,
    agent_icon: "noche", // Roby, the super-agent, wears the "Noche" blob
    kind: "super_agent",
    pinned: true,
    conversation_id: latest?.id || null,
    channel: latest?.channel || null,
    messages,
    preview,
    last_activity_at: latest?.last_ts || "",
  };
}
