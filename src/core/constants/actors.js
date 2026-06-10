// Stable actor identifiers used in message records, sessions, and confirmation
// flows. These are NEVER the persona name (which can be renamed) — they are
// machine ids so storage stays stable across persona renames.

// The super-agent (the daemon's default action loop, runs when no project agent
// was named). Identity (display name + personality) lives in identity.json and
// is resolved at runtime via resolveAgentName().
export const SUPERAGENT_ACTOR_ID = "super_agent";
