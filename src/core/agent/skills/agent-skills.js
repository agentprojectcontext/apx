// A project agent's DECLARED skills (its `skills:` frontmatter), resolved and
// rendered for the system prompt — with progressive disclosure.
//
// Until now every declared skill was injected whole into the prompt on EVERY
// run. Cheap for a small skill, wasteful for a big one: a 7 KB syllabus spent
// ~1.8 K tokens on every heartbeat even though a session teaches one section.
//
// The rule here:
//   • small skill (body ≤ EAGER_MAX_CHARS) → inject the full body. One round
//     trip saved is worth more than the tokens; there is nothing to page.
//   • large skill                          → inject a CARD: description, the
//     section outline, and the image manifest. The agent pulls the one section
//     it needs with read_skill, and attaches/looks at an image with
//     attach_media / view_media. Baseline tokens drop to the outline.
//
// This module is the single source both the prompt builder and the routine
// runner read from, so "what skills are in context" and "what images can the
// agent attach" never drift from what the prompt actually said.
import { loadSkill } from "./loader.js";
import { agentSkills } from "./declared.js";
import { skillOutline } from "./sections.js";
import { readSkillMedia, renderMediaManifest } from "./media.js";

// A skill whose body is at or under this many characters is injected whole.
// ~1800 chars ≈ 450 tokens — below that the card + a read_skill round trip
// would cost more than it saves.
export const EAGER_MAX_CHARS = 1800;

/**
 * Load an agent's declared skills with everything the prompt and the runner
 * need. Skills that fail to resolve are skipped (a stale `skills:` entry must
 * not crash a run).
 *
 * @returns {Array<{
 *   slug:string, mode:'eager'|'lazy', body:string, description:string,
 *   outline:string[], media:Array, file:string
 * }>}
 */
export function loadAgentSkills(project, agent) {
  const out = [];
  for (const slug of agentSkills(agent)) {
    let skill;
    try {
      skill = loadSkill(slug, { projectPath: project?.path });
    } catch {
      continue; // stale entry — silently skip, never throw mid-run
    }
    const body = String(skill.body || "").trim();
    const media = readSkillMedia(skill);
    // A skill with images is a large skill by nature (you page through it), so
    // it goes lazy even if the text is short — that is exactly when the media
    // manifest + read_skill pay off.
    const mode = body.length <= EAGER_MAX_CHARS && media.length === 0 ? "eager" : "lazy";
    out.push({
      slug,
      mode,
      body,
      description: skill.description || "",
      outline: skillOutline(body),
      media,
      file: skill.file || "",
    });
  }
  return out;
}

/**
 * The system-prompt block for a set of loaded skills. Eager skills print full;
 * lazy skills print a card (description + outline + image manifest) plus the
 * one-line instruction for how to pull more.
 */
export function renderAgentSkillsBlock(loaded) {
  const parts = [];
  for (const s of loaded) {
    if (s.mode === "eager") {
      parts.push(`## Skill: ${s.slug}\n${s.body}`);
      continue;
    }
    const lines = [`## Skill: ${s.slug} (loaded on demand)`];
    if (s.description) lines.push(s.description);
    if (s.outline.length) {
      lines.push(
        "Sections (call `read_skill` with the skill slug and a section title/number to read one):",
        ...s.outline.map((t) => `- ${t}`),
      );
    }
    const manifest = renderMediaManifest(s.media);
    if (manifest) lines.push(manifest);
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Every image across an agent's loaded skills, flattened and tagged with its
 * skill, for the runner to validate attach_media / view_media against and to
 * hand to delivery. Only images whose file actually exists are returned.
 */
export function collectAgentSkillMedia(loaded) {
  const out = [];
  for (const s of loaded) {
    for (const m of s.media) {
      if (!m.exists) continue;
      out.push({ skill: s.slug, id: m.id, path: m.path, caption: m.caption, mime: m.mime, file: m.file });
    }
  }
  return out;
}

/** Compact "skills in context" summary for the turn record (visibility). */
export function skillsInContextSummary(loaded) {
  return loaded.map((s) => ({
    slug: s.slug,
    mode: s.mode,
    sections: s.outline.length,
    images: s.media.filter((m) => m.exists).length,
  }));
}
