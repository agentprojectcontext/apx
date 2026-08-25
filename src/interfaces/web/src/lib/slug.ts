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
