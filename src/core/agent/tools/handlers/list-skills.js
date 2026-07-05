import { listSkills, SKILL_LOCATIONS } from "#core/agent/skills/loader.js";
import { condenseSkillDescription, filterEnabledSkills } from "#core/agent/skills/index.js";

export default {
  name: "list_skills",
  schema: {
    type: "function",
    function: {
      name: "list_skills",
      description:
        "List available skills (documentation modules) the super-agent can load on demand. Returns slug + 1-line description for each — NO body content (cheap). Call load_skill(slug) to actually fetch the doc when needed. Scans built-in skills shipped with apx, user-installed globals in ~/.apx/skills/, and project-scoped skills in <project>/.apc/skills/.",
      parameters: {
        type: "object",
        properties: {
          project_path: {
            type: "string",
            description: "optional project root to also scan for project-scoped skills (use the CWD when the user is working in a project)",
          },
        },
      },
    },
  },
  makeHandler: (ctx = {}) => ({ project_path } = {}) => {
    const skills = filterEnabledSkills(
      listSkills({ projectPath: project_path }),
      { config: ctx.globalConfig, projectPath: project_path },
    );
    return {
      ok: true,
      count: skills.length,
      locations: SKILL_LOCATIONS,
      project_path: project_path || null,
      skills: skills.map(({ slug, source, description }) => ({
        slug,
        source,
        description: condenseSkillDescription(description),
      })),
    };
  },
};
