// An agent's visual and organisational identity: its avatar blob and its
// typology.
//
// WHY THESE LIVE IN CORE. Both used to be web-only knowledge — the blob keys in
// `blobPresets.ts` and the five typologies hardcoded in `AgentDetailScreen.tsx`.
// So an agent created from the web got a face and a type, and the same agent
// created from the CLI, the MCP server or the super-agent got neither: it
// rendered as a grey lettered disc and carried no typology at all. The surfaces
// that create agents are not all in the browser, so the vocabulary can't be.

// Blob keys come from ./blob-keys.js, which `scripts/export_web_assets.py`
// generates alongside the renderer's blobPresets.ts — one generator, two
// consumers. `tests/agent-blob-parity.test.js` fails if the two ever drift.
export { BLOB_KEYS } from "./blob-keys.js";
import { BLOB_KEYS } from "./blob-keys.js";

/** Default super-agent avatar. Users may override it with super_agent.icon. */
export const SUPER_AGENT_BLOB = "noche";

export function isBlobKey(v) {
  return typeof v === "string" && BLOB_KEYS.includes(v);
}

/** Resolve a safe super-agent avatar from global config. */
export function resolveSuperAgentBlob(config) {
  return isBlobKey(config?.super_agent?.icon) ? config.super_agent.icon : SUPER_AGENT_BLOB;
}

/**
 * Choose an avatar for a new agent.
 *
 * Random, but not naively so: it draws from the blobs this project isn't
 * already using, so a team of six has six distinguishable faces instead of the
 * same one three times over — which is the whole point of having an avatar. Once
 * every blob is taken it falls back to the full list, since a repeat beats no
 * face at all.
 *
 * @param taken  blob keys already in use in this project
 * @param rng    injectable [0,1) source, for deterministic tests
 */
export function pickBlob({ taken = [], rng = Math.random } = {}) {
  const used = new Set([SUPER_AGENT_BLOB, ...taken.filter(isBlobKey)]);
  const free = BLOB_KEYS.filter((k) => !used.has(k));
  const pool = free.length > 0 ? free : BLOB_KEYS.filter((k) => k !== SUPER_AGENT_BLOB);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * Agent typologies. The value is what lands in `Type:` frontmatter; the label
 * and description are what the web shows in its picker.
 *
 * `orchestrator` also implies master: the web sets `is_master` when the type is
 * orchestrator, and the daemon does the same on create, so the hierarchy view
 * and the typology can't disagree.
 */
export const AGENT_TYPES = Object.freeze([
  { value: "orchestrator", label: "Orchestrator", description: "Coordinates the team and delegates." },
  { value: "specialist",   label: "Specialist",   description: "Domain expert; runs tasks." },
  { value: "assistant",    label: "Assistant",    description: "Conversational helper." },
  { value: "worker",       label: "Worker",       description: "Runs autonomous tasks." },
  { value: "monitor",      label: "Monitor",      description: "Watches state and reports." },
]);

export const AGENT_TYPE_VALUES = Object.freeze(AGENT_TYPES.map((t) => t.value));

export function isAgentType(v) {
  return typeof v === "string" && AGENT_TYPE_VALUES.includes(v);
}

/** Lowercase and validate. Returns null for empty/unknown input. */
export function normalizeAgentType(v) {
  const s = String(v || "").trim().toLowerCase();
  return isAgentType(s) ? s : null;
}
