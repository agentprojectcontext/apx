// Helpers for working with the skills catalog in the agent prompt.
//
// Two consumers:
//   1. The system-prompt builder injects a short HINT block (slugs only, no
//      bodies, no descriptions) so the model knows skills exist and how to
//      reach them — see buildSkillsHintBlock(). The full catalog (slug +
//      condensed description) is reached via the `list_skills` tool.
//   2. The `list_skills` tool itself renders descriptions using
//      condenseSkillDescription() — keeps the trigger-list tails out of the
//      tool result, same way the legacy catalog did.
//
// Skill descriptions are authored for Claude Code's skill matcher, so many end
// with verbose "Trigger on: …" / "Activate when …" / "Activa cuando…" lists.
// Inside the super-agent prompt those tails are pure noise (it matches
// semantically, not by trigger string). Keep the first sentence only, drop
// the trigger/activation tail, and cap length.

const TRIGGER_MARKER =
  /\s*(?:Trigger(?:s)? on|Triggers|TRIGGER|Activate (?:on|when|only)|Use this skill (?:whenever|when)|Use (?:it )?when|Triggers include|SKIP|Also (?:use|triggers)|Activa(?:r)? (?:cuando|en)|Disparadores|Usar cuando|Usá cuando|Se activa cuando)\b/i;

export function condenseSkillDescription(desc) {
  if (!desc) return "(no description)";
  const full = String(desc).replace(/\s+/g, " ").trim();
  // Prefer the gist before any trigger/activation marker; but if a skill leads
  // straight into "Activate ONLY when…" (no gist first), that head is empty —
  // fall back to the first sentence of the full text so we keep real info.
  let d = full.split(TRIGGER_MARKER)[0].trim();
  if (d.length < 15) d = full;
  // First sentence only, then cap length.
  const firstStop = d.search(/\.(\s|$)/);
  if (firstStop > 0) d = d.slice(0, firstStop + 1);
  d = d.trim();
  if (d.length > 160) d = d.slice(0, 157).trimEnd() + "…";
  return d || "(no description)";
}

/**
 * Compact "skills exist, here's how to reach them" block injected into every
 * super-agent system prompt. Lists slugs only (no descriptions, no bodies) so
 * the agent knows which slugs are reachable without paying the full catalog's
 * token cost. The model calls `list_skills` to see descriptions and
 * `load_skill` to load a body.
 *
 * Returns "" when there are no skills.
 */
export function buildSkillsHintBlock(listSkills) {
  let list = [];
  try {
    list = listSkills();
  } catch {
    /* empty */
  }
  if (!list.length) return "";
  const slugs = list.map((s) => s.slug).filter(Boolean);
  return [
    "# Available skills (catalog on demand)",
    `${slugs.length} skills are available. Bodies are NOT loaded. For details,`,
    "call `list_skills` (catalog with one-line descriptions) and then",
    "`load_skill({slug})` to load the body of the matching one. Match",
    "semantically — never by trigger string. Don't load a skill unless the",
    "current user request actually needs its exact syntax.",
    "",
    "Slugs: " + slugs.join(", "),
  ].join("\n");
}
