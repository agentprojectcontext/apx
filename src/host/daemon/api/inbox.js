// GET  /inbox        every agent as a conversation, most recent first, super-agent pinned
//                     ?limit=N&include_empty=1
// POST /inbox/read    mark rows read, for every surface at once
//
// The conversation-first entry point. Project-first navigation is unaffected —
// this is a second axis over the same data, not a replacement for it.
//
// Each row carries `unread`. The daemon answers it because the answer has to be
// the SAME one on the laptop and on the phone — when it was a browser's own
// localStorage, an afternoon of reading on one device left forty blue rows on
// the other. See core/stores/read-marks.js.
import { listAgentInbox } from "#core/stores/agent-inbox.js";
import { readReadMarks, decorateUnread, markRowsRead } from "#core/stores/read-marks.js";
import { listProjectA2AThreads, listProjectGroupThreads } from "#core/stores/messages.js";
import { listRecentProjectRuntimeRooms } from "#core/stores/runtime-room.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName } from "#core/identity/index.js";
import { faceResolverFor, readAgentsSafe, contactFaceFor, resolveContact } from "./thread-faces.js";
import { pageEnvelope, asyncRoute, A2A_SLUG_PREFIX, GROUP_SLUG_PREFIX, RUNTIME_SLUG_PREFIX } from "./shared.js";
import { broadcastReadMarks } from "../events-ws.js";
import { convTurnKey, threadTurnKey, getActiveTurnByKey, listActiveTurns } from "../active-turns.js";

function activeTurnForRow(row, activeTurns) {
  if (row.kind === "agent" && row.project_id != null && row.conversation_id) {
    return getActiveTurnByKey(convTurnKey(row.project_id, row.conversation_id));
  }
  // a2a and group threads are keyed by thread, not by conversation: the run
  // belongs to the pair, not to one agent's conversation file.
  if ((row.kind === "a2a" || row.kind === "group" || row.kind === "runtime") && row.project_id != null && row.conversation_id) {
    return getActiveTurnByKey(threadTurnKey(row.project_id, row.channel || row.kind, row.conversation_id));
  }
  if (row.kind === "super_agent" && row.channel && row.conversation_id) {
    return activeTurns.find((turn) =>
      turn.channel === row.channel && turn.thread_id === row.conversation_id
    ) || null;
  }
  return null;
}

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
        preview_at: th.preview_at || null,
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
        preview_at: th.preview_at || null,
        last_activity_at: th.last_ts,
      });
    }
  }
  return rows;
}

// A launched runtime session is a room too — one thread per session on the
// `runtime` channel. Folded in here for the same reason a2a and group rooms
// are: this is the one list that shows EVERY conversation, and a Claude Code
// session you can write to is a conversation.
//
// Asked for on 2026-09-20: "claude code, codex y opencode deberían verse en la
// lista de chats". Until then the only trace of a session was two rows inside
// whichever channel happened to launch it — a receipt, in someone else's
// thread, that you could read and not answer.
//
// The engine is the face. A room's participants are the engine plus whoever has
// written to it, and the title is the first line of the first prompt — what the
// session is ABOUT, which is the only thing that tells two of them apart.
async function runtimeInboxRows(entries) {
  const rows = [];
  for (const e of entries) {
    let rooms = [];
    // The last week, not the whole archive. A session from May is history with
    // a screen of its own (`/m/runtimes`); this list is the conversations you
    // might still answer. It also keeps the request cheap — the bounded reader
    // opens only the day files inside the window (see the store).
    try { rooms = await listRecentProjectRuntimeRooms(e.storagePath); } catch { /* skip */ }
    for (const room of rooms) {
      rows.push({
        project_id: e.id,
        project_name: e.name,
        project_path: e.path,
        agent_slug: `${RUNTIME_SLUG_PREFIX}${room.id}`,
        agent_name: room.title,
        agent_emoji: null,
        // THE ENGINE IS THE FACE. AgentAvatar ships a logo per engine, so
        // handing it the runtime's name here makes the row wear Claude's mark
        // with no branch in the row component: a list of chats where the coding
        // sessions are recognisable at a glance, which is the point of them
        // being in that list at all.
        agent_icon: room.runtime || null,
        kind: "runtime",
        runtime: room.runtime,
        cwd: room.cwd,
        phase: room.phase,
        participants: room.participants,
        participant_faces: [],
        pinned: false,
        conversation_id: room.id,
        channel: "runtime",
        messages: room.messages,
        preview: room.preview || null,
        preview_at: room.preview_at || null,
        last_activity_at: room.last_ts,
      });
    }
  }
  return rows;
}

export function register(api, { projects }) {
  api.get("/inbox", asyncRoute(async (req, res) => {
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
        // No `?channel=` means "show me everything", and everything now means
        // one row per channel rather than one row per agent wearing whichever
        // channel happened to speak last. Asking for a single channel already
        // answers the question, so it keeps the one-row-per-agent shape.
        perChannel: !channel,
      });

      // The super-agent's display name lives in identity.json, and core must not
      // reach for it — resolve it here, at the surface (AGENTS.md rule 4).
      const cfg = readConfig();
      const superName = resolveAgentName(cfg);
      // A super-agent row is titled by the agent — except on a channel that
      // carries several people, where the useful half is the OTHER side. Four
      // WhatsApp rows all reading "Roby · WhatsApp" tell the reader nothing
      // about which conversation each one is; "Magui", "Carlos", "Manu" do.
      // The badge under the name still says it was Roby who answered.
      const named = rows.map((r) => {
        if (r.kind !== "super_agent") return r;
        const who = resolveContact(r, cfg);
        const face = contactFaceFor(r, cfg);
        if (!face) return { ...r, agent_name: r.agent_name || superName };
        return {
          ...r,
          agent_name: face.name || r.agent_name || superName,
          // Their photo, or nothing — and nothing means the initial disc of
          // their own name. Falling back to Roby's blob here would put the
          // assistant's face on a row named after somebody else.
          agent_icon: face.icon || null,
          contact_face: face,
          contact_person: who?.key || null,
        };
      });

      // One row per PERSON, not per identity the ledger happened to record.
      //
      // The store groups by the key on the row, which is what was true when the
      // message arrived. Those keys drift apart whenever an identity is
      // corrected afterwards: Manu's first two WhatsApp messages were logged as
      // a guest's, because at that moment nothing knew the LID writing in was
      // the owner's — so the inbox showed two rows both called "Manu", one of
      // them a dead end. The ledger is right and stays as it is; this is the
      // reader deciding that a person appears once.
      //
      // The most recent wins. Sorted here rather than trusted from upstream:
      // which row survives is the whole point of this pass, and it must not
      // depend on the order a store happens to return.
      const seenPerson = new Set();
      const deduped = [...named]
        .sort((a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")))
        .filter((r) => {
          if (!r.contact_person) return true;
          const key = `${r.channel}\u0000${r.contact_person}`;
          if (seenPerson.has(key)) return false;
          seenPerson.add(key);
          return true;
        });

      // Faces and titles for the multi-agent rows: one resolver for the request,
      // shared with the Chats sidebar and the thread header (thread-faces.js).
      // It knows the super-agent's own face too, so "golf-coach ↔ Roby" shows
      // Roby with an avatar instead of the bare `super_agent` slug.
      const faces = faceResolverFor(projects);

      // Merge a2a group chats in and re-sort so the newest conversation wins
      // regardless of whether it was an individual or a group one.
      const activeTurns = listActiveTurns();
      const merged = [...deduped, ...a2aInboxRows(entries, faces), ...groupInboxRows(entries, faces), ...(await runtimeInboxRows(entries))]
        .map((row) => ({ ...row, active_turn: activeTurnForRow(row, activeTurns) }))
        .sort(
        (a, b) => new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime()
      );

      // Read state last, over the finished list: it is a property of the row as
      // the reader sees it, and the merge above is what decides which rows
      // those are.
      const marks = await readReadMarks();
      const envelope = pageEnvelope(decorateUnread(merged, marks), req.query);
      if (skipped.length) envelope.meta = { ...(envelope.meta || {}), skipped };
      res.json(envelope);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // Reading it counts as having been told — on every surface, not just this one.
  //
  // The body carries each row's identity plus the utterance that was read
  // (`at` = the `preview_at` the caller had in hand). Its own timestamp and not
  // `now`: an answer that landed between the fetch and this call has not been
  // read by anybody and must stay unread.
  api.post("/inbox/read", asyncRoute(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: "rows must be an array" });
    const marked = await markRowsRead(rows);
    // Only when something moved: this frame makes every open panel revalidate,
    // and a list that re-fetches every 15s does not need a third reason to.
    if (marked) broadcastReadMarks();
    res.json({ ok: true, marked });
  }));
}
