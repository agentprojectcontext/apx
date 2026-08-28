// GET /inbox   every agent as a conversation, most recent first, super-agent pinned
//              ?limit=N&include_empty=1
//
// The conversation-first entry point. Project-first navigation is unaffected —
// this is a second axis over the same data, not a replacement for it.
import { listAgentInbox } from "#core/stores/agent-inbox.js";
import { listProjectA2AThreads, listProjectGroupThreads } from "#core/stores/messages.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName } from "#core/identity/index.js";
import { faceResolverFor, readAgentsSafe } from "./thread-faces.js";
import { pageEnvelope, A2A_SLUG_PREFIX, GROUP_SLUG_PREFIX } from "./shared.js";

// a2a "group chats" aren't any single agent's conversation, so listAgentInbox
// (per-agent) doesn't see them. Fold each project's a2a pairs in as their own
// rows — this is the one place that shows EVERY conversation, so a group chat
// belongs here next to the individual ones.
//
// Faces and the "Andy · Claude" title come from the shared resolver in
// thread-faces.js, the same one the Chats sidebar and the thread header read
// through — this row is not where that gets decided.
function a2aInboxRows(entries, faces) {
  const rows = [];
  for (const e of entries) {
    let threads = [];
    try { threads = listProjectA2AThreads(e.storagePath); } catch { /* skip */ }
    const agents = readAgentsSafe(e.path);
    for (const raw of threads) {
      const th = faces.decorate(raw, agents);
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `${A2A_SLUG_PREFIX }${th.id}`,
        agent_name: th.title,
        agent_emoji: null,
        agent_icon: null,
        kind: "a2a",
        participants: th.participants,
        participant_faces: th.participant_faces,
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

// Group rooms (owner + N agents) are threads on the ledger, same as a2a — fold
// them in here too so the one place that shows EVERY conversation shows them.
// Shaped exactly like an a2a row (kind "group") so the frontend reuses the same
// multi-face rendering and thread-selection it already has for a2a.
function groupInboxRows(entries, faces) {
  const rows = [];
  for (const e of entries) {
    let threads = [];
    try { threads = listProjectGroupThreads(e.storagePath); } catch { /* skip */ }
    const agents = readAgentsSafe(e.path);
    for (const raw of threads) {
      const th = faces.decorate(raw, agents);
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `${GROUP_SLUG_PREFIX}${th.id}`,
        agent_name: th.title,
        agent_emoji: null,
        agent_icon: null,
        kind: "group",
        participants: th.participants,
        participant_faces: th.participant_faces,
        pinned: false,
        conversation_id: th.id,
        channel: "group",
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

      // `?channel=web` scopes the individual-agent rows to one channel — the
      // inbox and the phone are web-only so a Telegram thread never surfaces
      // there. a2a group rows are their own channel and are added below,
      // unaffected by this filter.
      const channel = typeof req.query.channel === "string" && req.query.channel
        ? req.query.channel
        : null;

      const { rows, skipped } = listAgentInbox(entries, {
        includeEmpty: req.query.include_empty === "1" || req.query.include_empty === "true",
        channel,
      });

      // The super-agent's display name lives in identity.json, and core must not
      // reach for it — resolve it here, at the surface (AGENTS.md rule 4).
      const cfg = readConfig();
      const superName = resolveAgentName(cfg);
      const named = rows.map((r) =>
        r.kind === "super_agent" ? { ...r, agent_name: r.agent_name || superName } : r
      );

      // Faces and titles for the multi-agent rows: one resolver for the request,
      // shared with the Chats sidebar and the thread header (thread-faces.js).
      // It knows the super-agent's own face too, so "golf-coach ↔ Roby" shows
      // Roby with an avatar instead of the bare `super_agent` slug.
      const faces = faceResolverFor(projects);

      // Merge a2a group chats in and re-sort so the newest conversation wins
      // regardless of whether it was an individual or a group one.
      const merged = [...named, ...a2aInboxRows(entries, faces), ...groupInboxRows(entries, faces)].sort(
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
