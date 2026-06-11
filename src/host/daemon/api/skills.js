// Lightweight `/skills` listing for UI surfaces (web composer picker,
// future palettes). Same data backing `list_skills` tool, but here without
// auth-binding to a project — anyone with a valid daemon token can ask
// "which skills are around right now?".
//
// Returns the catalog already condensed (slug + first-sentence description)
// so the picker doesn't have to repeat the cleanup work.
import { listSkills } from "#core/agent/skills/loader.js";
import { condenseSkillDescription } from "#core/agent/skills/catalog.js";

export function register(app /*, ctx */) {
  app.get("/skills", (req, res) => {
    const projectPath = typeof req.query?.project_path === "string"
      ? req.query.project_path
      : undefined;
    try {
      const skills = listSkills({ projectPath });
      res.json({
        count: skills.length,
        skills: skills.map(({ slug, source, description }) => ({
          slug,
          source,
          description: condenseSkillDescription(description),
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
