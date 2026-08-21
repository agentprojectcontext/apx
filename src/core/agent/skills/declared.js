// Reading list-valued frontmatter fields off an agent card. Lives in its own
// module so both the prompt builder (build-agent-system.js) and the skill
// loader (agent-skills.js) can share it without an import cycle.

export function listField(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** The skill slugs an agent declares in its `skills:` frontmatter. */
export function agentSkills(agent) {
  return listField(agent?.fields?.Skills);
}
