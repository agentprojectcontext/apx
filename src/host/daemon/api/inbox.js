// GET /inbox   every agent as a conversation, most recent first, super-agent pinned
//              ?limit=N&include_empty=1
//
// The conversation-first entry point. Project-first navigation is unaffected —
// this is a second axis over the same data, not a replacement for it.
import { listAgentInbox } from "#core/stores/agent-inbox.js";
import { listProjectA2AThreads, listProjectGroupThreads } from "#core/stores/messages.js";
import { readAgents } from "#core/apc/parser.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { pageEnvelope, A2A_SLUG_PREFIX, GROUP_SLUG_PREFIX } from "./shared.js";

// Resolve a participant slug to the same face the rest of the app draws: a
// project agent wears its blob/emoji; the super-agent is NOT a project agent, so
// it needs its own face (name from identity.json, blob from config) or an a2a
// thread it is in renders the bare `super_agent` slug with no avatar; a coding
// CLI (claude/codex/…) isn't an agent either, so it falls through to the name
// (AgentAvatar maps it to a brand logo).
function faceOfAgent(a) {
  return {
    name: a?.fields?.Name || a?.name || null,
    emoji: a?.fields?.Emoji || a?.emoji || null,
    icon: a?.fields?.Icon || a?.icon || null,
  };
}

// Coding CLIs aren't project agents (no .apc file, so no face resolves), but an
// a2a pair with one should read as its brand, not a bare lowercase slug. Keys
// match the frontend's CLI_LOGOS so the logo still lands (it matches on the
// lowercased name), the label just wears proper case.
const CLI_DISPLAY_NAMES = {
  claude: "Claude",
  "claude-code": "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  "cursor-agent": "Cursor",
  aider: "Aider",
  gemini: "Gemini",
  qwen: "Qwen",
};

// An a2a pair can span projects — crypto-analyst lives in `default` while the
// thread it shares with roby is logged under nicho-apps. A face looked up only
// in the thread's own project renders as a bare letter for the outsider, so we
// resolve against EVERY project's agents (the thread's own first, then the rest)
// before falling back to the slug.
function participantFace(localAgents, globalIndex, slug, superFace) {
  if (slug === SUPERAGENT_ACTOR_ID) return superFace;
  const local = localAgents.find((x) => x.slug === slug);
  const resolved = local ? faceOfAgent(local) : globalIndex.get(slug) || null;
  return {
    // A project agent's own name; else a coding CLI's brand name (Claude, Cursor,
    // OpenCode…) so it doesn't read as a bare lowercase slug; else the slug.
    name: resolved?.name || CLI_DISPLAY_NAMES[String(slug).toLowerCase()] || slug,
    emoji: resolved?.emoji || null,
    icon: resolved?.icon || null,
  };
}

// slug -> face across all projects, so a cross-project a2a participant still
// wears its real avatar. First project to define a slug wins — collisions are
// rare and the thread's own project is tried before this map anyway.
function buildAgentIndex(entries) {
  const idx = new Map();
  for (const e of entries) {
    let agents = [];
    try { agents = e.path ? readAgents(e.path) : []; } catch { continue; }
    for (const a of agents) if (!idx.has(a.slug)) idx.set(a.slug, faceOfAgent(a));
  }
  return idx;
}

// a2a "group chats" aren't any single agent's conversation, so listAgentInbox
// (per-agent) doesn't see them. Fold each project's a2a pairs in as their own
// rows — this is the one place that shows EVERY conversation, so a group chat
// belongs here next to the individual ones.
function a2aInboxRows(entries, superFace) {
  const globalIndex = buildAgentIndex(entries);
  const rows = [];
  for (const e of entries) {
    let threads = [];
    try { threads = listProjectA2AThreads(e.storagePath); } catch { /* skip */ }
    let agents = [];
    try { agents = e.path ? readAgents(e.path) : []; } catch { /* skip */ }
    for (const th of threads) {
      const faces = (th.participants || []).map((slug) => participantFace(agents, globalIndex, slug, superFace));
      // Title from the RESOLVED display names, not the raw slugs — "golf-coach ·
      // Roby", never "golf-coach · super_agent".
      const title = faces.length ? faces.map((f) => f.name).join(" · ") : th.title;
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `${A2A_SLUG_PREFIX }${th.id}`,
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

// Group rooms (owner + N agents) are threads on the ledger, same as a2a — fold
// them in here too so the one place that shows EVERY conversation shows them.
// Shaped exactly like an a2a row (kind "group") so the frontend reuses the same
// multi-face rendering and thread-selection it already has for a2a.
function groupInboxRows(entries, superFace) {
  const globalIndex = buildAgentIndex(entries);
  const rows = [];
  for (const e of entries) {
    let threads = [];
    try { threads = listProjectGroupThreads(e.storagePath); } catch { /* skip */ }
    let agents = [];
    try { agents = e.path ? readAgents(e.path) : []; } catch { /* skip */ }
    for (const th of threads) {
      const faces = (th.participants || []).map((slug) => participantFace(agents, globalIndex, slug, superFace));
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `${GROUP_SLUG_PREFIX}${th.id}`,
        agent_name: th.title || faces.map((f) => f.name).join(" · "),
        agent_emoji: null,
        agent_icon: null,
        kind: "group",
        participants: th.participants,
        participant_faces: faces,
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

      // The face an a2a thread draws for the super-agent: its human name and its
      // blob, so "golf-coach ↔ Roby" shows Roby (with an avatar), not the slug.
      const superFace = {
        name: superName,
        emoji: null,
        icon: cfg?.super_agent?.icon || cfg?.desktop?.blob || null,
      };

      // Merge a2a group chats in and re-sort so the newest conversation wins
      // regardless of whether it was an individual or a group one.
      const merged = [...named, ...a2aInboxRows(entries, superFace), ...groupInboxRows(entries, superFace)].sort(
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
