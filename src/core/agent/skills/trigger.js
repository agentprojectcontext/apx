// Interface-agnostic skill trigger.
//
// When a user message starts with `/<slug>` (e.g. "/apx-routine help me add one"),
// this helper resolves the slug against the skill catalog and pulls the body
// into a structured block to inject into the next turn — so the model has the
// exact syntax without paying for the catalog every turn.
//
// Returns:
//   { handled: false }            — message had no slash command
//   { handled: true, prompt, contextNote, skill, rest }
//     prompt:      the user's text minus the slash command (or "tell me how to use <skill>"
//                  when only the slash command was sent)
//     contextNote: a multi-line block ready to pass as `contextNote` to runSuperAgent
//     skill:       { slug, body, source } — the loaded skill
//     rest:        the user's text without the `/<slug>` prefix (handy for callers
//                  that want to render or transform it themselves)
//
// Resolution rules:
//   - The first whitespace-separated token must start with `/`.
//   - The slug after the slash is matched case-insensitively against listSkills().
//   - Project-scoped skills (.apc/skills/) win when projectPath is provided.
//   - An unknown slug falls through ({ handled: false }) so callers can choose
//     to surface a "no such skill" message or pass through unchanged.
import { listSkills, loadSkill } from "./loader.js";

const SLASH_RE = /^\/([A-Za-z][A-Za-z0-9_-]*)\b/;

export function tryResolveSkillCommand(message, { projectPath } = {}) {
  if (typeof message !== "string") return { handled: false };
  const trimmed = message.replace(/^\s+/, "");
  const m = trimmed.match(SLASH_RE);
  if (!m) return { handled: false };

  const slug = m[1].toLowerCase();
  const rest = trimmed.slice(m[0].length).trimStart();

  let skills = [];
  try {
    skills = listSkills({ projectPath });
  } catch {
    return { handled: false };
  }
  const match = skills.find((s) => s.slug.toLowerCase() === slug);
  if (!match) return { handled: false };

  let body = "";
  try {
    const loaded = loadSkill(match.slug, { projectPath });
    body = loaded.body || "";
  } catch {
    body = "";
  }

  const prompt = rest || `Use the **${match.slug}** skill to help me.`;
  const contextNote = [
    `# Skill loaded on demand: \`${match.slug}\``,
    "The user invoked this skill explicitly with a `/slug` prefix. Use the",
    "instructions below for this turn instead of guessing. Don't re-call",
    "load_skill for the same slug — its body is right here.",
    "",
    body,
  ].join("\n");

  return {
    handled: true,
    prompt,
    contextNote,
    skill: { slug: match.slug, body, source: match.source },
    rest,
  };
}
