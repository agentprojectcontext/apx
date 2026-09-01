// Who an a2a message can be addressed to.
//
// `to` used to mean "an agent in AGENTS.md", and that alone is why a coding CLI
// could talk INTO APX but never the other way round: `apx send claude opencode
// "…"` died on `no agent "opencode"`. A PEER is the generalisation — a project
// agent, the daemon super-agent, or an external runtime (opencode, codex,
// claude-code, …). Same envelope, ledger and pair history; only reply execution
// differs.
//
// Address syntax: <name>[:<thread>]
//
//   andy               an AGENTS.md agent (unchanged)
//   opencode           the runtime, on its default thread with this sender
//   opencode:review    a SECOND, independent thread with the same peer
//
// The `:thread` suffix stays part of the ledger slug, and the ledger keys
// threads by the literal pair of names (see a2aPairId in stores/messages.js) —
// so two threads with the same peer never share history. That is what lets two
// IDE sessions talk to the same runtime without reading each other's mail, and
// it needs no new store: the discriminator IS the address.
//
// The separator is `:` and not `#` because these names end up in a URL — the
// web opens a thread at /super-agent/threads/a2a/<pairId>. A `#` is a fragment
// delimiter: the browser cuts the address in half before the request leaves,
// and every thread with a suffix 404s. `:` survives the trip (encoded or not),
// which api/conversations.js already relies on for the `a2a:` slug itself.
import { RUNTIME_IDS } from "#core/runtimes/index.js";
import { resolveAgentName } from "#core/identity/self.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";

const SUPERAGENT_PEERS = new Set(["default", "superagent", "super_agent", "super-agent", "apx"]);

/** Split "<name>:<thread>". A leading ":" is not a suffix — that is the name. */
export function parsePeerAddress(address) {
  const raw = String(address || "").trim();
  const sep = raw.indexOf(":");
  if (sep <= 0) return { address: raw, name: raw, thread: null };
  return {
    address: raw,
    name: raw.slice(0, sep),
    thread: raw.slice(sep + 1) || null,
  };
}

export function isRuntimeName(name) {
  return RUNTIME_IDS.includes(String(name || ""));
}

/** Find the real project agent claimed by an addressable name. */
export function findAddressedAgent(name, agents = []) {
  const raw = String(name || "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    agents.find((a) => a.slug === raw) ||
    agents.find((a) => a.slug?.toLowerCase() === lower) ||
    agents.find((a) => (a.name || a.fields?.Name || "").toLowerCase() === lower) ||
    null
  );
}

/**
 * Whether a name addresses the daemon super-agent mode. The configured
 * identity is an alias too; the stable ledger identity stays super_agent.
 */
export function isSuperAgentName(name, config = {}) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return false;
  const configuredName = (resolveAgentName(config) || "").trim().toLowerCase();
  return SUPERAGENT_PEERS.has(raw) || (configuredName && raw === configuredName);
}

/**
 * Resolve an address to whoever will answer it. An agent wins over a runtime of
 * the same name: a project that named an agent `codex` still owns that name.
 * Returns null when nothing claims it, so the caller can 404 with the options.
 */
export function resolvePeer(address, agents = [], config = {}) {
  const { address: full, name, thread } = parsePeerAddress(address);
  if (!full) return null;

  // A real project agent wins over every synthetic identity. This preserves a
  // project that intentionally owns an agent named `apx`, `default`, or Roby.
  const agent = findAddressedAgent(name, agents);

  if (agent) return { kind: "agent", address: full, name: agent.slug, thread, agent };

  if (isRuntimeName(name)) {
    return { kind: "runtime", address: full, name, thread, runtime: name };
  }

  // Super-agent fallback: aliases and configured identity all reach the same
  // full daemon-level mode, never a fabricated project-agent model call.
  if (isSuperAgentName(name, config)) {
    const displayName = resolveAgentName(config);
    return {
      kind: "super_agent",
      address: full,
      // ONE name for the super-agent on the ledger, whichever alias was typed.
      // This used to answer to `default`, so `apx send magui default "…"` filed
      // the exchange under a peer called "default" — a name no agent list, face
      // resolver or reader can place, while the very same super-agent appears as
      // `super_agent` everywhere else. Manu saw the result in his inbox: "Magui
      // is talking to `default`, which does not exist". The aliases still all
      // resolve; they just stop minting a second identity for the same agent.
      name: SUPERAGENT_ACTOR_ID,
      thread,
      agent: {
        slug: SUPERAGENT_ACTOR_ID,
        name: displayName,
        fields: {
          Name: displayName,
          Role: "Super-agent / Orchestrator",
          Type: "orchestrator",
          Description: "Always-on orchestrator and chief of staff",
        },
        synthetic: true,
      },
    };
  }

  return null;
}

/**
 * The canonical address of a resolved peer — its real name, keeping any
 * `:thread` suffix. What a caller should WRITE to the ledger instead of the
 * string it was handed: `default`, `Roby`, `apx` and `roby` are one peer, and
 * without this each spelling opened a thread of its own. The suffix stays, since
 * it is the discriminator two threads with the same peer are keyed by.
 */
export function peerAddress(peer) {
  if (!peer?.name) return "";
  return peer.thread ? `${peer.name}:${peer.thread}` : peer.name;
}

/**
 * The key naming the external session an a2a thread owns. Sorted, so both
 * directions of the same exchange resolve to the SAME session — the thread is
 * one conversation, not two. Runtimes that can only find their session again by
 * name (opencode titles it) use this verbatim.
 */
export function a2aSessionKey(from, to) {
  return `apx-a2a:${[String(from || ""), String(to || "")].sort().join("~")}`;
}

/**
 * Runtimes that are never opened as a `--code` peer.
 *
 * Not a capability judgement — both can code perfectly well, and `apx run`
 * still drives them that way. It is a wiring decision: these two are the CLIs
 * the owner drives directly, so letting a message also start them on a working
 * session means the same checkout has two writers and nobody can tell which one
 * made a change. They answer as read-only peers; the work goes to opencode or
 * to a `apx run`. A flat list beats a rule with conditions.
 */
export const NO_CODE_PEERS = Object.freeze(["claude-code", "codex"]);

export function refusesCodeMode(peer) {
  return peer?.kind === "runtime" && NO_CODE_PEERS.includes(peer.runtime);
}
