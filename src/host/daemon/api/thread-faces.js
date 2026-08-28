// Who is in a multi-agent thread, and what that thread is CALLED.
//
// An a2a or group thread is a conversation BETWEEN agents, so every surface
// that shows one — the inbox rows, the Chats sidebar, the thread header on the
// desktop and on the phone — has to answer the same two questions: which faces
// to draw, and what name to put on it. There was no single answer: the inbox
// resolved both here in the API, the sidebar re-derived faces in React from its
// own agent list, and the thread header could only do it when the inbox handed
// it the row it had already resolved. Same ledger, three resolutions, two of
// them incomplete — which is why `/m/inbox` drew "Andy · OpenCode" with both
// avatars while `/p/0/chat` drew the same thread as a faceless `andy~opencode`.
//
// So it is answered ONCE, here, and travels ON the payload: `participant_faces`
// plus a resolved `title`. Every frontend renders what it is given; none of them
// re-derives a face from a slug.
//
// It lives at the surface rather than in core because the super-agent's display
// name comes from identity.json and core must not reach for it (rule 4).
import { readAgents } from "#core/apc/parser.js";
import { readConfig } from "#core/config/index.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";

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
      icon: cfg?.super_agent?.icon || cfg?.desktop?.blob || null,
    };
    return superFace;
  };

  /** `localAgents` (the thread's own project roster) wins over every other project. */
  const face = (slug, localAgents = []) => {
    if (slug === SUPERAGENT_ACTOR_ID) return { ...superAgentFace() };
    const local = localAgents.find((a) => a.slug === slug);
    const hit = local ? faceOfAgent(local) : globalIndex().get(slug) || null;
    return {
      // Physical key, so a surface can OPEN this agent and not just paint it.
      slug,
      // A project agent's own name; else a coding CLI's brand name (Claude,
      // Cursor, OpenCode…) so it doesn't read as a bare lowercase slug; else
      // the slug itself.
      name: hit?.name || CLI_DISPLAY_NAMES[String(slug).toLowerCase()] || slug,
      emoji: hit?.emoji || null,
      icon: hit?.icon || null,
    };
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
    return {
      ...thread,
      participant_faces: faces,
      title: isDerived ? faces.map((f) => f.name).join(" · ") : own,
    };
  };

  return { face, decorate };
}

/** The same resolver, built from a ProjectManager-style list of entries. */
export function faceResolverFor(projects) {
  let paths = [];
  try { paths = projects.list().map((e) => e.path).filter(Boolean); } catch { /* none registered */ }
  return createFaceResolver(paths);
}
