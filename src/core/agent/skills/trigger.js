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
import { filterEnabledSkills } from "./policy.js";

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

// ---------------------------------------------------------------------------
// Keyword triggers ("option B", OpenHands-style) — opt-in, default OFF.
//
// Skills may declare `triggers:` (a list of keywords) in their SKILL.md
// frontmatter. When `config.skills.keyword_triggers.enabled` is true, each
// user message is scanned: a case-insensitive SUBSTRING match of any keyword
// auto-injects that skill's body for the turn — no embeddings, no model call.
// First matching keyword wins per skill; at most `max_matches` skills are
// injected (priority: project > global > builtin, then alphabetical); each
// body is capped at `body_char_cap` chars. Skills without `triggers` are
// never considered, and disabled skills (policy.js) are excluded.
// ---------------------------------------------------------------------------

// Defaults — exported so the CLI/web/daemon can render + validate them.
export const KEYWORD_TRIGGER_DEFAULTS = Object.freeze({
  enabled: false,        // OPT-IN — the semantic inspector stays the default.
  max_matches: 2,        // at most this many skills injected per turn
  body_char_cap: 6000,   // hard cap per injected body (token guard)
});

// Keywords shorter than this are ignored — substring matching on 1–2 char
// keywords ("a", "of") would fire on almost every message.
const MIN_KEYWORD_LEN = 3;

const SOURCE_RANK = { project: 0, global: 1, builtin: 2 };

function keywordTriggerConfig(config) {
  return { ...KEYWORD_TRIGGER_DEFAULTS, ...(config?.skills?.keyword_triggers || {}) };
}

/** Quick probe so callers can decide whether to run the matcher at all. */
export function areKeywordTriggersEnabled(config) {
  return keywordTriggerConfig(config).enabled === true;
}

function renderKeywordNote({ slug, keyword, body }) {
  return [
    `# Skill auto-activated by keyword: \`${slug}\` (matched "${keyword}")`,
    "This skill declares keyword triggers and one matched the user's message.",
    "Use the instructions below for this turn. Don't re-call load_skill for",
    "the same slug — its body is right here.",
    "",
    body,
  ].join("\n");
}

/**
 * Match the user message against the keyword triggers of enabled skills.
 *
 * @param {string} message           the raw user message
 * @param {object} opts
 * @param {string=} opts.projectPath project root (project skills shadow global)
 * @param {object=} opts.config      global config (feature gate + caps + policy)
 * @returns {{ matched: Array<{slug, keyword, source}>, contextNote?: string }}
 */
export function matchSkillKeywordTriggers(message, { projectPath, config } = {}) {
  const cfg = keywordTriggerConfig(config);
  if (!cfg.enabled) return { matched: [] };
  if (typeof message !== "string" || !message.trim()) return { matched: [] };

  let skills = [];
  try {
    skills = filterEnabledSkills(listSkills({ projectPath }), { config, projectPath });
  } catch {
    return { matched: [] };
  }

  const candidates = skills
    .filter((s) => Array.isArray(s.triggers) && s.triggers.length > 0)
    .sort((a, b) => {
      const rank = (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
      return rank !== 0 ? rank : a.slug.localeCompare(b.slug);
    });

  const haystack = message.toLowerCase();
  const maxMatches = Math.max(0, Number(cfg.max_matches) || 0);
  const bodyCap = Math.max(1, Number(cfg.body_char_cap) || KEYWORD_TRIGGER_DEFAULTS.body_char_cap);

  const matched = [];
  const notes = [];
  for (const skill of candidates) {
    if (matched.length >= maxMatches) break;
    const keyword = skill.triggers.find(
      (k) => k.length >= MIN_KEYWORD_LEN && haystack.includes(k.toLowerCase())
    );
    if (!keyword) continue;

    let body = "";
    try {
      body = loadSkill(skill.slug, { projectPath }).body || "";
    } catch {
      continue;
    }
    if (body.length > bodyCap) {
      body = body.slice(0, bodyCap) + "\n\n…(skill body truncated — call load_skill for the full text)";
    }
    matched.push({ slug: skill.slug, keyword, source: skill.source });
    notes.push(renderKeywordNote({ slug: skill.slug, keyword, body }));
  }

  if (!matched.length) return { matched: [] };
  return { matched, contextNote: notes.join("\n\n") };
}
