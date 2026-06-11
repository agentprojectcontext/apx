import { loadSkill } from "#core/agent/skills/loader.js";

export default {
  name: "load_skill",
  schema: {
    type: "function",
    function: {
      name: "load_skill",
      description:
        "Load the full body of a named skill (markdown documentation, frontmatter stripped). Use after list_skills found a relevant slug. Resolves the slug via priority: project > global (~/.apx/skills/) > built-in. The body is loaded into the conversation only on the turn you call this — keeps baseline tokens at zero.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "skill slug as listed by list_skills (e.g. \"apx\", \"apc-context\")",
          },
          project_path: {
            type: "string",
            description: "optional project root for resolving project-scoped skills",
          },
        },
        required: ["slug"],
      },
    },
  },
  makeHandler: () => ({ slug, project_path } = {}) => {
    if (!slug) throw new Error("load_skill: slug required");
    return loadSkill(slug, { projectPath: project_path });
  },
};
