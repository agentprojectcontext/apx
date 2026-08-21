import { setAgentConfig } from "#core/apc/agent-write.js";
import { readAgents } from "#core/apc/parser.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Change an existing agent's frontmatter (model, type, area, role, skills, …)
// without touching its system prompt (use set_agent_prompt for that). Completes
// the agent CRUD: create_agent → set_agent_prompt → configure_agent → remove_agent.
export default {
  name: "configure_agent",
  schema: {
    type: "function",
    function: {
      name: "configure_agent",
      description:
        "Edit an existing agent's settings (its frontmatter): model, type, area, role, description, language, skills, tools, emoji/icon, autonomy, parent, is_master. Keeps the system prompt (use set_agent_prompt to change that). Only the fields you pass change; pass an empty string to clear one.",
      parameters: {
        type: "object",
        required: ["agent"],
        properties: {
          project:     { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          agent:       { type: "string", description: "Slug of the agent to edit (from list_agents)." },
          model:       { type: "string", description: "Per-agent model override (empty string clears it → follows the default)." },
          role:        { type: "string", description: "One-line role." },
          description: { type: "string", description: "One line of metadata for listings." },
          language:    { type: "string", description: "Default language code, e.g. 'es'." },
          type:        { type: "string", description: "Agent typology (specialist, orchestrator, …)." },
          area:        { type: "string", description: "Org area slug/name." },
          skills:      { type: "array", items: { type: "string" }, description: "Replace the skill list." },
          tools:       { type: "array", items: { type: "string" }, description: "Replace the tools allowlist (declaring one NARROWS the agent)." },
          emoji:       { type: "string", description: "Emoji badge." },
          icon:        { type: "string", description: "Avatar blob key." },
          autonomy:    { type: "string", description: "Per-agent autonomy: total | automatico | permiso." },
          parent:      { type: "string", description: "Parent agent slug." },
          is_master:   { type: "boolean", description: "Mark/unmark as a master agent." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async (args = {}) => {
    const { project, agent } = args;
    await requirePermission("configure_agent", { dangerous: true, args: { agent, project } });
    if (!agent) return { error: "agent required" };
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      setAgentConfig(p, agent, args);
      projects.rebuild(p.id);
      const updated = readAgents(p.path).find((a) => a.slug === agent);
      const f = updated?.fields || {};
      return {
        ok: true,
        project: projectMeta(projects, p),
        agent: {
          slug: agent,
          role: f.Role || null,
          model: f.Model || null,
          type: f.Type || null,
          area: f.Area || null,
          skills: f.Skills || [],
        },
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
