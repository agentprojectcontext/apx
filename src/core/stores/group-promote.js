// Turning the chat you are IN into a room, instead of opening a new one beside it.
//
// THE BUG THIS REPLACES. "Add someone" in a 1:1 called `POST /projects/:pid/
// groups` with the two slugs and navigated away. That creates a room, and the
// room is empty: the conversation you were having stays in the agent's own file,
// invisible from the room, and the agent you just invited joins a thread with no
// history — so the first thing anybody has to do is re-explain what was already
// said. Manu, 2026-09-20: "cuando estamos en un chat común e invito a alguien,
// en vez de invitarlo y ya convertir ese chat en grupo, arma otro chat en grupo
// y eso rompe todo."
//
// So the invite PROMOTES the chat. The transcript is replayed onto the room's
// ledger, in order and at the times it was actually said, and the source
// conversation is archived with a pointer to where it went. From then on there
// is exactly one place the conversation lives, and the person who just walked in
// can read what happened before they did.
//
// WHY REPLAY RATHER THAN LINK. A room is a ledger thread; a 1:1 is a markdown
// file under one agent. Linking would mean every reader of a room — the viewer,
// the cascade's history builder, truncation, deletion, search — learning about a
// second storage shape it would have to go and read. Replaying costs one write
// per turn, once, and afterwards the room is an ordinary room.
//
// WHAT IS NOT CARRIED. `system` turns (the agent's own prompt) and `tool` rows.
// The first belongs to the agent, not to the conversation; the second is the
// work behind a turn, already summarised on the turn itself, and re-filing it
// here would hand the room's next cascade a context full of somebody else's
// tool output. `compact` rows are a 1:1's own bookkeeping and mean nothing in a
// room.
import {
  createGroupThread, appendGroupOwnerMessage, appendGroupAgentMessage,
  readProjectA2AThread,
} from "./messages.js";
import { readConversation, setConversationMeta } from "./conversations.js";

/** The flat media keys a ledger row spreads into `meta` (see mediaFromMeta).
 *  Carried verbatim so a photo sent in the 1:1 is still a photo in the room. */
const MEDIA_KEYS = [
  "media_kind", "file_id", "local_path", "file_name", "mime_type", "file_size",
  "duration", "width", "height", "transcription_backend",
];

function mediaMetaOf(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const k of MEDIA_KEYS) if (meta[k] !== undefined) out[k] = meta[k];
  return Object.keys(out).length ? out : null;
}

/** One millisecond before `iso`, so the room's creation row sorts ahead of the
 *  first line it introduces. `groupRows` orders by timestamp and nothing else. */
function justBefore(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return new Date(t - 1).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Promote a 1:1 conversation into a group room, carrying its transcript.
 *
 * @param {object}   o
 * @param {string}   o.storagePath       ~/.apx/projects/<apx_id>
 * @param {Function} o.logMessage        the project's ledger writer
 * @param {string}   o.agentSlug         whose conversation this is
 * @param {string}   o.conversationId    which one
 * @param {string[]} o.participants      the room's roster (agentSlug included)
 * @param {string|null}  o.title
 * @param {object|null}  o.homes         slug → project id, for a cross-project room
 * @param {boolean}  o.archiveSource     put the 1:1 away once it has been carried
 *
 * @returns {{id: string, imported: number, from: {agent: string, conversation: string}}}
 *   `imported` counts the turns that reached the room — 0 for a chat that had
 *   not been spoken in yet, which is a perfectly ordinary new room.
 */
export function promoteConversationToGroup({
  storagePath,
  logMessage,
  agentSlug,
  conversationId,
  participants = [],
  title = null,
  homes = null,
  archiveSource = true,
}) {
  if (!agentSlug) throw new Error("promote: an agent is required");
  if (!conversationId) throw new Error("promote: a conversation is required");
  const conv = readConversation(storagePath, agentSlug, conversationId);
  if (!conv) throw new Error(`promote: no conversation ${conversationId} for ${agentSlug}`);

  // The agent you were talking to is IN the room it becomes — that is what
  // "convert this chat" means. A caller that forgot to list it is corrected
  // rather than refused: the alternative is a room holding somebody else's
  // conversation with the one person missing who had it.
  const roster = [...new Set([agentSlug, ...participants.filter(Boolean)])];

  const carried = (conv.turns || []).filter(
    (t) => (t.role === "user" || t.role === "assistant") && String(t.content || "").trim(),
  );

  const group_id = createGroupThread(logMessage, {
    participants: roster,
    title: title || conv.fm?.title || null,
    homes,
    ts: justBefore(carried[0]?.ts),
    from: { agent: agentSlug, conversation: conversationId },
  });

  let imported = 0;
  for (const t of carried) {
    const media = mediaMetaOf(t.meta);
    if (t.role === "user") {
      appendGroupOwnerMessage(logMessage, group_id, t.content, media, { ts: t.ts });
    } else {
      appendGroupAgentMessage(logMessage, group_id, {
        // Which agent actually spoke. A conversation file records it per turn
        // (a room's cascade and a hand-off both write into one file), so an
        // imported line is attributed to whoever said it rather than to
        // whoever's file it sits in.
        slug: t.meta?.agent || agentSlug,
        body: t.content,
        model: t.meta?.model || null,
        usage: t.meta?.usage || null,
        ts: t.ts,
        ...(media ? { media: [media] } : {}),
      });
    }
    imported += 1;
  }

  // The 1:1 is history now, and two live copies of one conversation is the
  // thing this whole function exists to avoid. Archived rather than deleted:
  // the record of what was said is never ours to throw away, and `archived`
  // only takes it out of the lists that offer chats to resume.
  if (archiveSource) {
    try {
      setConversationMeta(storagePath, agentSlug, conversationId, {
        archived: true,
        promoted_to_group: group_id,
      });
    } catch { /* a room that exists beats a tidy sidebar */ }
  }

  return { id: group_id, imported, from: { agent: agentSlug, conversation: conversationId } };
}

/**
 * Promote an a2a pair into a room the owner is in.
 *
 * "Los agent to agent para mí son grupo, entonces cuando empiezo a hablar
 * deberían convertirse en grupo" — Manu, 2026-09-20. He is describing what the
 * two things actually are: an a2a thread is a conversation between agents with
 * no seat for the owner, and the moment the owner has something to say, the
 * conversation they want is a room. Until now typing into an a2a pane sent a
 * super-agent web turn instead — the line vanished from the thread it was
 * written in and landed on another channel entirely.
 *
 * WHO ENDS UP IN THE ROOM. The pair's ends that are PROJECT AGENTS, and only
 * those. A room is "the owner plus N project agents": the super-agent is not a
 * member of one (it is the thing that would otherwise be speaking for the
 * owner, and in a room the owner speaks for themselves), and an external coding
 * runtime is not a member either — nothing can seat it. So `roby~magui` becomes
 * a room with Magui in it and the owner in Roby's place, which is the
 * conversation that was wanted; `andy~magui` becomes a room with both.
 *
 * The a2a thread itself is LEFT ALONE. It is the record of two agents talking
 * and the ledger is append-only: the room is where the conversation continues,
 * not a replacement for what it was.
 *
 * @param {object}   o
 * @param {string}   o.storagePath
 * @param {Function} o.logMessage
 * @param {string}   o.threadId      the pair id (`a~b`)
 * @param {string[]} o.knownAgents   this project's roster — who may be seated
 * @param {string[]} o.participants  anyone else being pulled in at the same time
 * @param {string|null} o.title
 * @param {object|null} o.homes
 *
 * @returns {{id: string, imported: number, participants: string[], from: {thread: string}}}
 */
export function promoteA2AThreadToGroup({
  storagePath,
  logMessage,
  threadId,
  knownAgents = [],
  participants = [],
  title = null,
  homes = null,
}) {
  if (!threadId) throw new Error("promote: a thread is required");
  const thread = readProjectA2AThread(storagePath, threadId);
  if (!thread) throw new Error(`promote: no a2a thread ${threadId}`);

  const known = new Set(knownAgents);
  const seatable = (thread.participants || []).filter((slug) => known.has(slug));
  const roster = [...new Set([...seatable, ...participants.filter((s) => known.has(s))])];
  if (!roster.length) {
    // Nothing in this pair can hold a seat — two coding runtimes, or a pair
    // whose agents have since been removed. Said plainly rather than opening a
    // room with nobody in it, which is a thread that can never answer.
    throw new Error("promote: neither side of this pair is an agent of this project");
  }

  const carried = (thread.messages || []).filter((m) => String(m.content || "").trim());

  const group_id = createGroupThread(logMessage, {
    participants: roster,
    title: title || thread.title || null,
    homes,
    ts: justBefore(carried[0]?.ts),
    from: { thread: threadId },
  });

  let imported = 0;
  for (const m of carried) {
    // Every utterance in a pair is an agent's — there is no owner in an a2a
    // thread, which is the whole reason this promotion exists. A speaker who
    // cannot be seated (the super-agent, a runtime) still SAID it, so the line
    // is carried under its own name rather than dropped or re-attributed.
    appendGroupAgentMessage(logMessage, group_id, {
      slug: m.agent || m.agent_slug || roster[0],
      body: m.content,
      model: m.model || null,
      usage: m.usage || null,
      ts: m.ts,
      ...(m.media ? { media: [m.media] } : {}),
    });
    imported += 1;
  }

  return { id: group_id, imported, participants: roster, from: { thread: threadId } };
}
