import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";

// Re-export so callers that already imported the actor id from here keep
// working. The single source of truth lives in core/constants/actors.js.
export { SUPERAGENT_ACTOR_ID };

export const IDENTITY_PATH = path.join(os.homedir(), ".apx", "identity.json");

// Shown when no persona is configured yet. Brand of the app, not a persona.
export const SUPERAGENT_DISPLAY_FALLBACK = "APX";

export function readIdentity() {
  try {
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch {
    return null;
  }
}

// Resolve the super-agent's DISPLAY name (the persona shown to users). Order:
// identity.json persona → legacy super_agent.name → "APX". This is the single
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

export function writeIdentity(fields) {
  const existing = readIdentity() || {};
  const now = new Date().toISOString();
  const updated = { ...existing, ...fields, updated: now };
  if (!updated.created) updated.created = now;
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}
