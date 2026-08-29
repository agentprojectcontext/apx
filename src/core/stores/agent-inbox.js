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
import { CHANNELS } from "../constants/channels.js";
import { listGlobalThreads, readGlobalThread } from "./messages.js";
import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";
import { readConfig } from "../config/index.js";
import { resolveSuperAgentBlob } from "../apc/agent-identity.js";

/**
 * One entry per channel, keeping the FIRST seen — which is the most recent,
 * because every list feeding this is already sorted newest-first.
 *
 * Written out rather than `new Map(items.map(…))`: that form keeps the LAST
 * duplicate, so it silently picked each channel's OLDEST conversation and every
 * row wore a months-stale date and preview.
 */
function latestPerChannel(items) {
  const byChannel = new Map();
  for (const item of items) {
    if (!byChannel.has(item.channel)) byChannel.set(item.channel, item);
  }
  return [...byChannel.values()];
}

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
 *   - channel        scope each row to ONE channel (e.g. "web"): the row's
 *                    headline conversation must be on that channel, and an agent
 *                    with none drops out (unless includeEmpty). The inbox and the
 *                    phone pass "web" so a Telegram thread never surfaces there;
 *                    project-first navigation passes nothing and sees every channel.
 *   - perChannel     emit one row per (agent, channel) instead of a single
 *                    headline per agent, so a list can group by channel and a
 *                    quiet channel is not hidden behind a louder one. Ignored
 *                    when `channel` is set — that already scopes to one.
 * @returns {{ rows: object[], skipped: {id:any, error:string}[] }}
 */
export function listAgentInbox(projects, opts = {}) {
  const { limit, includeEmpty = false, channel = null, perChannel = false } = opts || {};
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
      // A routine conversation is not a chat: the routine runs on its own and
      // its delivered output lands in the agent's web chat, which is the row we
      // want to show. Chatting inside the routine thread happens, but it should
      // not become the agent's inbox entry — pick the latest NON-routine
      // conversation instead. An agent whose only activity is routine runs has
      // no chat to show and drops out of the inbox (unless includeEmpty).
      //
      // When `channel` is set, the headline must be on THAT channel — the inbox
      // and the phone are web-only, so an agent whose only chat is on Telegram
      // has nothing to show there and drops out (unless includeEmpty).
      const eligible = conversations.filter((c) =>
        channel ? c.channel === channel : c.channel !== CHANNELS.ROUTINE,
      );
      // `perChannel`: one row per channel this agent was talked to on, instead
      // of a single headline. An agent reached on WhatsApp AND on the web is
      // two conversations, and collapsing them to whichever spoke last hid the
      // other one entirely — which is the whole reason WhatsApp threads were
      // invisible even once they were being written.
      const headlines = perChannel ? latestPerChannel(eligible) : [eligible[0] || null];
      if (!headlines[0] && !includeEmpty) continue;

      for (const latest of headlines) {
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
          // WHEN that reply was written — which is not when the thread last
          // moved. A row moves for the owner's own send and for every tool the
          // agent runs; only this moves when the agent actually SAYS something,
          // which is the difference between one notification per answer and one
          // per step of a 24-step turn. See lib/notify.ts.
          preview_at: latest?.preview_at || null,
          last_activity_at: latest?.last_turn_at || latest?.started_at || "",
        });
      }
    }
  }

  rows.sort(byRecency);

  // The super-agent is the single voice the owner talks to and the others
  // report through it. It is pinned first and marked distinct so the hierarchy
  // is visible, rather than sorted in among its own reports.
  const superRows = buildSuperAgentRows({ channel, perChannel });
  const out = [...superRows, ...rows];

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
function buildSuperAgentRows(opts = {}) {
  const { channel = null, perChannel = false } = opts || {};
  let threads = [];
  try {
    threads = listGlobalThreads();
  } catch {
    threads = [];
  }

  const eligible = threads.filter((t) =>
    channel ? t.channel === channel : t.channel !== CHANNELS.ROUTINE,
  );
  // The super-agent is the one the owner actually talks to, so it is where
  // per-channel matters most: telegram, whatsapp, web and desktop are four
  // conversations, not one row wearing whichever channel spoke last.
  if (perChannel) {
    const heads = latestPerChannel(eligible);
    if (!heads.length) return [superAgentRow(null, threads)];
    return heads.map((t) => superAgentRow(t, threads));
  }
  return [superAgentRow(eligible[0] || null, threads)];
}

/** One super-agent row for one headline thread (or none yet). */
function superAgentRow(latest, threads) {
  // `messages` counts every thread on purpose: it is the super-agent's total
  // volume, not this row's. The headline is picked by the caller — a routine
  // run is never one, and the row stays pinned even with no thread yet (it
  // falls through to a live session).
  const messages = threads.reduce((n, t) => n + (t.messages || 0), 0);

  let preview = null;
  // When that reply was written. The thread's own `last_ts` moves for the
  // owner's send too, so it cannot answer "did the agent say something new" —
  // which is the only question a notification should be asking.
  let previewAt = null;
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
      previewAt = lastReply?.ts || null;
    } catch {
      preview = null;
      previewAt = null;
    }
  }

  return {
    project_id: null,
    project_name: null,
    project_path: null,
    agent_slug: SUPERAGENT_ACTOR_ID,
    agent_name: null, // resolved by the surface via resolveAgentName()
    agent_emoji: null,
    agent_icon: resolveSuperAgentBlob(readConfig()),
    kind: "super_agent",
    pinned: true,
    conversation_id: latest?.id || null,
    channel: latest?.channel || null,
    messages,
    preview,
    preview_at: previewAt,
    last_activity_at: latest?.last_ts || "",
  };
}
