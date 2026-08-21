// read_skill — pull ONE section of a skill on demand, instead of carrying the
// whole skill in the prompt. The system prompt shows a lazy skill's outline
// (its section titles); this fetches the body of the section the agent names.
// Called with no section, it returns the outline + image manifest so the agent
// can see what it can ask for.
import { loadSkill } from "#core/agent/skills/loader.js";
import { splitSkillSections, skillOutline, pickSkillSection } from "#core/agent/skills/sections.js";
import { readSkillMedia } from "#core/agent/skills/media.js";

export default {
  name: "read_skill",
  schema: {
    type: "function",
    function: {
      name: "read_skill",
      description:
        "Read one section of a skill loaded on demand (progressive disclosure). Pass the skill slug and a section title or number to get that section's text; omit the section to get the list of sections and images. Use this for a skill the system prompt showed as '(loaded on demand)'.",
      parameters: {
        type: "object",
        properties: {
          skill: { type: "string", description: "skill slug, e.g. \"golf-lvl-2\"" },
          section: {
            type: "string",
            description: "section title (fuzzy) or number, e.g. \"2\" or \"Técnica del Swing\". Omit to list sections.",
          },
          project_path: { type: "string", description: "optional project root for project-scoped skills" },
        },
        required: ["skill"],
      },
    },
  },
  makeHandler: (ctx = {}) => ({ skill, section, project_path } = {}) => {
    if (!skill) throw new Error("read_skill: skill required");
    const projectPath = project_path || ctx?.channelMeta?.projectPath || undefined;
    let loaded;
    try {
      loaded = loadSkill(skill, { projectPath });
    } catch (e) {
      return { error: e?.message || `skill "${skill}" not found` };
    }
    const body = String(loaded.body || "").trim();
    const media = readSkillMedia(loaded).filter((m) => m.exists);

    if (!section || !String(section).trim()) {
      return {
        skill: loaded.slug,
        description: loaded.description || "",
        sections: skillOutline(body),
        all_headings: splitSkillSections(body).filter((s) => s.title).map((s) => s.title),
        images: media.map((m) => ({ id: m.id, caption: m.caption })),
        hint: "Call read_skill again with { section: \"<title or number>\" } to read one.",
      };
    }

    const found = pickSkillSection(body, section);
    if (!found) {
      return {
        error: `no section matching "${section}" in ${loaded.slug}`,
        sections: skillOutline(body),
      };
    }
    return { skill: loaded.slug, section: found.title, body: found.text };
  },
};
