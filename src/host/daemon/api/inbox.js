// GET /inbox   every agent as a conversation, most recent first, super-agent pinned
//              ?limit=N&include_empty=1
//
// The conversation-first entry point. Project-first navigation is unaffected —
// this is a second axis over the same data, not a replacement for it.
import { listAgentInbox } from "#core/stores/agent-inbox.js";
import { listProjectA2AThreads } from "#core/stores/messages.js";
import { readAgents } from "#core/apc/parser.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { pageEnvelope } from "./shared.js";

// Resolve a participant slug to the same face the rest of the app draws: a
// project agent wears its blob/emoji; the super-agent is NOT a project agent, so
// it needs its own face (name from identity.json, blob from config) or an a2a
// thread it is in renders the bare `super_agent` slug with no avatar; a coding
// CLI (claude/codex/…) isn't an agent either, so it falls through to the name
// (AgentAvatar maps it to a brand logo).
function participantFace(agents, slug, superFace) {
  if (slug === SUPERAGENT_ACTOR_ID) return superFace;
  const a = agents.find((x) => x.slug === slug);
  return {
    name: a?.fields?.Name || slug,
    emoji: a?.fields?.Emoji || a?.emoji || null,
    icon: a?.fields?.Icon || a?.icon || null,
  };
}

// a2a "group chats" aren't any single agent's conversation, so listAgentInbox
// (per-agent) doesn't see them. Fold each project's a2a pairs in as their own
// rows — this is the one place that shows EVERY conversation, so a group chat
// belongs here next to the individual ones.
function a2aInboxRows(entries, superFace) {
  const rows = [];
  for (const e of entries) {
    let threads = [];
    try { threads = listProjectA2AThreads(e.storagePath); } catch { /* skip */ }
    let agents = [];
    try { agents = e.path ? readAgents(e.path) : []; } catch { /* skip */ }
    for (const th of threads) {
      const faces = (th.participants || []).map((slug) => participantFace(agents, slug, superFace));
      // Title from the RESOLVED display names, not the raw slugs — "golf-coach ·
      // Roby", never "golf-coach · super_agent".
      const title = faces.length ? faces.map((f) => f.name).join(" · ") : th.title;
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `a2a:${th.id}`,
        agent_name: title,
        agent_emoji: null,
        agent_icon: null,
        kind: "a2a",
        participants: th.participants,
        participant_faces: faces,
        ...(th.requested_by ? { requested_by: th.requested_by } : {}),
        pinned: false,
        conversation_id: th.id,
        channel: "a2a",
        messages: th.messages,
        preview: th.preview || null,
        last_activity_at: th.last_ts,
      });
    }
  }
  return rows;
}

export function register(api, { projects }) {
  api.get("/inbox", (req, res) => {
    try {
      const entries = [];
      for (const entry of projects.list()) {
        const p = projects.get(entry.id);
        if (!p?.storagePath) continue;
        entries.push({
          id: entry.id,
          name: entry.name || entry.path,
          path: entry.path,
          storagePath: p.storagePath,
        });
      }

      const { rows, skipped } = listAgentInbox(entries, {
        includeEmpty: req.query.include_empty === "1" || req.query.include_empty === "true",
      });

      // The super-agent's display name lives in identity.json, and core must not
      // reach for it — resolve it here, at the surface (AGENTS.md rule 4).
      const cfg = readConfig();
      const superName = resolveAgentName(cfg);
      const named = rows.map((r) =>
        r.kind === "super_agent" ? { ...r, agent_name: r.agent_name || superName } : r
      );

      // The face an a2a thread draws for the super-agent: its human name and its
      // blob, so "golf-coach ↔ Roby" shows Roby (with an avatar), not the slug.
      const superFace = {
        name: superName,
        emoji: null,
        icon: cfg?.super_agent?.icon || cfg?.desktop?.blob || null,
      };

      // Merge a2a group chats in and re-sort so the newest conversation wins
      // regardless of whether it was an individual or a group one.
      const merged = [...named, ...a2aInboxRows(entries, superFace)].sort(
        (a, b) => new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime()
      );

      const envelope = pageEnvelope(merged, req.query);
      if (skipped.length) envelope.meta = { ...(envelope.meta || {}), skipped };
      res.json(envelope);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
