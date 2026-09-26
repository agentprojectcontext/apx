// Kebab-case a free-text name into a slug. Mirrors the backend's slugifyName
// (core/stores/organization.js) so a name typed in the web produces the same
// slug the daemon would derive.
export function slugify(name: string): string {
  return String(name || "")
    // Strip diacritics first so "José" → "jose" (not "jos"); mirrors the backend.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// What an agent slug must look like — mirrors AGENT_SLUG_RE in
// core/apc/agent-write.js.
export const AGENT_SLUG_RE = /^[a-z][a-z0-9_-]*$/;

// The slug an agent NAME yields: slugify, then drop whatever precedes the first
// letter ("3PO" → "po"). Mirrors agentSlugFromName in core/apc/agent-write.js;
// tests/agent-slug-parity.test.js keeps the two equal.
export function agentSlugFromName(name: string): string {
  return slugify(name).replace(/^[^a-z]+/, "");
}
