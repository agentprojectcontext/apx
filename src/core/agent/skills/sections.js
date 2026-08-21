// Splitting a skill body into sections, so a large skill can be loaded one
// section at a time instead of whole (progressive disclosure). A project agent
// gets the skill's OUTLINE (its headings) in the system prompt for ~nothing,
// and pulls the one section it needs with the read_skill tool.
//
// Sectioning is by markdown headings. A heading owns everything under it until
// the next heading at the SAME or a HIGHER level — so a `##` section carries
// its `###` subsections with it, which is what a reader wants when they ask for
// "section 2".

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;

/**
 * Parse a markdown body into a flat list of headings with their span.
 * @returns {Array<{level:number, title:string, line:number}>}
 */
function headings(body) {
  const lines = String(body || "").split("\n");
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Don't mistake a `#` inside a ``` code fence for a heading.
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (m) out.push({ level: m[1].length, title: m[2].trim(), line: i });
  }
  return out;
}

/**
 * Sections of a skill body: each heading plus the text it owns (down to the
 * next heading at the same or higher level). Text BEFORE the first heading is
 * returned as a leading section with an empty title (the skill's preamble).
 *
 * @returns {Array<{level:number, title:string, text:string}>}
 */
export function splitSkillSections(body) {
  const text = String(body || "");
  const lines = text.split("\n");
  const heads = headings(text);
  const sections = [];

  if (!heads.length) {
    const t = text.trim();
    return t ? [{ level: 0, title: "", text: t }] : [];
  }

  // Preamble before the first heading.
  if (heads[0].line > 0) {
    const pre = lines.slice(0, heads[0].line).join("\n").trim();
    if (pre) sections.push({ level: 0, title: "", text: pre });
  }

  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    // The section ends at the next heading whose level is <= this one's.
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { end = heads[j].line; break; }
    }
    sections.push({
      level: h.level,
      title: h.title,
      text: lines.slice(h.line, end).join("\n").trim(),
    });
  }
  return sections;
}

/**
 * A compact outline for the system prompt: the top-level headings (levels 1-2),
 * numbered, so the model can name a section to read_skill without the bodies.
 * @returns {string[]}  e.g. ["1. Evaluaciones de Habilidad", "2. Técnica del Swing"]
 */
export function skillOutline(body, { maxLevel = 2 } = {}) {
  return splitSkillSections(body)
    .filter((s) => s.title && s.level >= 1 && s.level <= maxLevel)
    .map((s) => s.title);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Find the section a `query` refers to. Accepts a title (fuzzy, accent- and
 * case-insensitive), a leading section number ("2" or "2."), or a substring of
 * a title. Returns the best section, or null.
 *
 * @returns {{title:string, text:string, level:number}|null}
 */
export function pickSkillSection(body, query) {
  const sections = splitSkillSections(body).filter((s) => s.title);
  if (!sections.length) return null;
  const q = norm(query);
  if (!q) return null;

  // "2" / "2." → the section whose title starts with that number, else the Nth.
  const numMatch = /^(\d+)\.?$/.exec(String(query).trim());
  if (numMatch) {
    const n = numMatch[1];
    const byPrefix = sections.find((s) => new RegExp(`^${n}\\b`).test(s.title.trim()));
    if (byPrefix) return byPrefix;
    const idx = Number(n) - 1;
    if (idx >= 0 && idx < sections.length) return sections[idx];
  }

  // Exact normalized title.
  const exact = sections.find((s) => norm(s.title) === q);
  if (exact) return exact;

  // Query contained in a title, or a title contained in the query.
  const contains = sections.find((s) => {
    const t = norm(s.title);
    return t.includes(q) || q.includes(t);
  });
  if (contains) return contains;

  // Token overlap — pick the title sharing the most words with the query.
  const qTokens = new Set(q.split(" ").filter(Boolean));
  let best = null;
  let bestScore = 0;
  for (const s of sections) {
    const tTokens = s.title ? norm(s.title).split(" ").filter(Boolean) : [];
    const score = tTokens.reduce((n, tok) => n + (qTokens.has(tok) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : null;
}
