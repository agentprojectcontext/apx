// Who is in a multi-agent thread, and what that thread is CALLED.
//
// An a2a or group thread is a conversation BETWEEN agents, so every surface
// that shows one — the inbox rows, the Chats sidebar, the thread header on the
// desktop and on the phone — has to answer the same two questions: which faces
// to draw, and what name to put on it. There was no single answer: the inbox
// resolved both here in the API, the sidebar re-derived faces in React from its
// own agent list, and the thread header could only do it when the inbox handed
// it the row it had already resolved. Same ledger, three resolutions, two of
// them incomplete — which is why `/inbox` drew "Andy · OpenCode" with both
// avatars while `/p/0/chat` drew the same thread as a faceless `andy~opencode`.
//
// So it is answered ONCE, here, and travels ON the payload: `participant_faces`
// plus a resolved `title`. Every frontend renders what it is given; none of them
// re-derives a face from a slug.
//
// It lives at the surface rather than in core because the super-agent's display
// name comes from identity.json and core must not reach for it (rule 4).
import { readAgents } from "#core/apc/parser.js";
import { resolveSuperAgentBlob } from "#core/apc/agent-identity.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { parsePeerAddress } from "#core/agent/a2a/peers.js";

const LEGACY_SUPER_AGENT_SLUGS = new Set([
  "default", "superagent", "super-agent", "super_agent", "apx", "roby", "__super_agent__",
]);

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

/** The three display fields an agent carries, from either shape it arrives in. */
function faceOfAgent(a) {
  return {
    name: a?.fields?.Name || a?.name || null,
    emoji: a?.fields?.Emoji || a?.emoji || null,
    icon: a?.fields?.Icon || a?.icon || null,
  };
}

/** An unreadable AGENTS.md is one project without faces, never a failed request. */
export function readAgentsSafe(dir) {
  try { return dir ? readAgents(dir) : []; } catch { return []; }
}

/**
 * A resolver for one request: `slug → face`, and `thread → decorated thread`.
 *
 * `projectPaths` are the working-copy paths of every registered project, because
 * an a2a pair can SPAN them — a coding CLI in one project talking to an agent
 * that lives in another. A face looked up only in the thread's own project
 * renders the outsider as a bare letter, so the cross-project index is the
 * fallback. It is built lazily: a request whose participants all live in the
 * caller's own roster never opens another project's AGENTS.md.
 */
export function createFaceResolver(projectPaths = []) {
  let index = null;
  const globalIndex = () => {
    if (index) return index;
    index = new Map();
    for (const dir of projectPaths) {
      // First project to define a slug wins — collisions are rare, and the
      // caller's own roster is tried before this map anyway.
      for (const a of readAgentsSafe(dir)) if (!index.has(a.slug)) index.set(a.slug, faceOfAgent(a));
    }
    return index;
  };

  let superFace = null;
  const superAgentFace = () => {
    if (superFace) return superFace;
    let cfg = null;
    try { cfg = readConfig(); } catch { /* no config is not a reason to draw nothing */ }
    // The super-agent is not a project agent, so nothing above resolves it: it
    // needs its persona name and its blob, or an a2a thread it is in renders the
    // bare `super_agent` slug with no avatar.
    superFace = {
      slug: SUPERAGENT_ACTOR_ID,
      name: resolveAgentName(cfg || {}),
      emoji: null,
      icon: resolveSuperAgentBlob(cfg || {}),
    };
    return superFace;
  };

  /** `localAgents` (the thread's own project roster) wins over every other project. */
  const face = (address, localAgents = []) => {
    // An a2a peer may carry a SESSION: `claude-code:acme-web` is Claude, working
    // in acme-web — one speaker, one of possibly several conversations with
    // them. The
    // identity is the part before the colon; the suffix says which thread.
    //
    // Resolving the whole string as if it were a slug is why the panel drew
    // "claude-code:acme-web · APX" and a header that read like a group name: no
    // roster and no CLI brand list has an entry called `claude-code:acme-web`, so
    // it fell through to printing the raw address.
    const { name: slug, thread: session } = parsePeerAddress(address);
    const withSession = (f) => (session ? { ...f, slug: address, session } : f);

    if (slug === SUPERAGENT_ACTOR_ID) return withSession({ ...superAgentFace() });
    const local = localAgents.find((a) => a.slug === slug);
    const hit = local ? faceOfAgent(local) : globalIndex().get(slug) || null;
    if (!hit && LEGACY_SUPER_AGENT_SLUGS.has(String(slug).toLowerCase())) {
      return withSession({ ...superAgentFace() });
    }
    if (!hit && String(slug).toLowerCase() === "roby-orchestrator") {
      return withSession({
        slug,
        name: "Roby Orchestrator",
        emoji: null,
        icon: superAgentFace().icon,
      });
    }
    return withSession({
      // Physical key, so a surface can OPEN this agent and not just paint it.
      // Keeps the session suffix when there is one: two conversations with the
      // same peer are two threads, and a click has to land on the right one.
      slug,
      // A project agent's own name; else a coding CLI's brand name (Claude,
      // Cursor, OpenCode…) so it doesn't read as a bare lowercase slug; else
      // the slug itself.
      name: hit?.name || CLI_DISPLAY_NAMES[String(slug).toLowerCase()] || slug,
      emoji: hit?.emoji || null,
      icon: hit?.icon || null,
    });
  };

  /**
   * Add `participant_faces` and a display `title` to an a2a / group thread.
   *
   * Anything without participants (a Telegram day, a web thread) is returned
   * untouched — this decorates multi-agent threads, it does not reshape the
   * ledger.
   *
   * A title the STORE derived from slugs (`andy~claude-code`'s pair join, or a
   * group with no name of its own) is the same question asked before the faces
   * were known, so it is answered again with them: "Andy · Claude". A group
   * someone actually named keeps that name.
   */
  const decorate = (thread, localAgents = []) => {
    const participants = Array.isArray(thread?.participants) ? thread.participants : null;
    if (!participants?.length) return thread;
    const faces = participants.map((slug) => face(slug, localAgents));
    const own = String(thread.title || "");
    const isDerived = !own || own === participants.join(" · ") || own === thread.id;
    // Two conversations with the same peer would otherwise render the same
    // title; the session is what tells them apart, so it rides in the title
    // when there is one. "Claude · APX" and "Claude (acme-web) · APX".
    const label = (f) => (f.session ? `${f.name} (${f.session})` : f.name);
    return {
      ...thread,
      participant_faces: faces,
      title: isDerived ? faces.map(label).join(" · ") : own,
    };
  };

  return { face, decorate };
}

/**
 * The face of the PERSON a channel thread is with — not an agent's.
 *
 * WhatsApp threads are the one place where the other side of the conversation
 * is a human with a name and a photo of their own, and the surfaces already
 * know how to draw a face: they just had nothing to draw. Without this a
 * sidebar of WhatsApp threads is four identical Roby discs, and the header of
 * an open one names the assistant rather than the person it is talking to.
 *
 * The name is the ledger's (it is what the channel actually called them when
 * the message arrived, so a rename in the roster shows up without rewriting
 * history); the picture is the roster's, which is the only place it is kept.
 * Both are optional — a stranger has no roster row at all — and a face with
 * neither still renders as an initial, which is better than nothing.
 */
export function contactFaceFor(thread, cfg) {
  const who = resolveContact(thread, cfg);
  if (!who) return null;
  const { row, name } = who;
  if (!name && !row?.avatar_url) return null;
  // `icon` rather than a field of its own: AgentAvatar is the one renderer
  // every surface calls, and it takes a URL here.
  return { name, icon: row?.avatar_url || null, emoji: null };
}

/**
 * WHICH PERSON a thread's contact key names, today.
 *
 * A key is what the ledger recorded when the message arrived; the roster is who
 * that turned out to be. Those differ whenever an identity is corrected after
 * the fact — Manu's first two WhatsApp messages were logged under `role: guest`,
 * because at that moment the system genuinely did not know the LID writing to it
 * was the owner's. The ledger is not wrong and must not be rewritten: it says
 * what was true then. It is the READER that should show one person once.
 *
 * Returns `{ key, row, name }` where `key` is stable per person, so a surface
 * can group by it.
 */
export function resolveContact(thread, cfg) {
  if (!thread?.contact) return null;
  const wa = cfg?.whatsapp || {};
  const contacts = Array.isArray(wa.contacts) ? wa.contacts : [];
  const ownerAddrs = [wa.owner_jid, ...(Array.isArray(wa.owner_alts) ? wa.owner_alts : []), wa.self_jid]
    .filter(Boolean)
    .map((a) => String(a).toLowerCase());
  // The owner's key is a constant, not an address: find their row by any of the
  // addresses the config records for them.
  const isOwner =
    thread.contact === "owner" || ownerAddrs.includes(String(thread.contact).toLowerCase());
  const wanted = isOwner ? ownerAddrs : [String(thread.contact).toLowerCase()];
  const row = contacts.find((c) =>
    [c?.jid, ...(Array.isArray(c?.alts) ? c.alts : [])]
      .filter(Boolean)
      .some((a) => wanted.includes(String(a).toLowerCase())),
  );
  return {
    // One key per person: the owner is always "owner" whichever line they wrote
    // from, and a contact is their roster jid whichever alias reached us.
    key: isOwner ? "owner" : String(row?.jid || thread.contact).toLowerCase(),
    row: row || null,
    name: thread.contact_name || row?.nickname || row?.name || null,
  };
}

/** The same resolver, built from a ProjectManager-style list of entries. */
export function faceResolverFor(projects) {
  let paths = [];
  try { paths = projects.list().map((e) => e.path).filter(Boolean); } catch { /* none registered */ }
  return createFaceResolver(paths);
}
