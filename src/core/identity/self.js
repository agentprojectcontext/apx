import fs from "node:fs";
import path from "node:path";
import { IDENTITY_PATH } from "../config/paths.js";

export { IDENTITY_PATH };
import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";
import { readJson } from "#core/util/json-file.js";

// Re-export so callers that already imported the actor id from here keep
// working. The single source of truth lives in core/constants/actors.js.
export { SUPERAGENT_ACTOR_ID };



// Shown when no persona is configured yet. Brand of the app, not a persona.
export const SUPERAGENT_DISPLAY_FALLBACK = "APX";

export function readIdentity() {
  return readJson(IDENTITY_PATH, null);
}

// Resolve the super-agent's DISPLAY name (the persona shown to users). Order:
// identity.json agent_name → super_agent.name → "APX". This is the single
// source of truth for "what is the super-agent called"; callers must not read
// super_agent.name directly. The stable id for storage is SUPERAGENT_ACTOR_ID.
export function resolveAgentName(globalConfig = {}) {
  const identity = readIdentity();
  return (
    identity?.agent_name ||
    globalConfig?.super_agent?.name ||
    SUPERAGENT_DISPLAY_FALLBACK
  );
}

// Shown when the owner has not told the agent their name. Neutral on purpose:
// a name written into a shipped prompt is ONE install's owner introducing
// himself in everybody else's.
export const OWNER_DISPLAY_FALLBACK = "the owner";

// Resolve the OWNER's display name — the person the super-agent works for —
// from identity.json (`owner_name`, written by `set_identity`). Every prompt
// that addresses the owner by name goes through here; none may hardcode one.
export function resolveOwnerName() {
  const identity = readIdentity();
  return identity?.owner_name || OWNER_DISPLAY_FALLBACK;
}

export function writeIdentity(fields) {
  const existing = readIdentity() || {};
  const now = new Date().toISOString();
  const updated = { ...existing, ...fields, updated: now };
  if (!updated.created) updated.created = now;
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}
