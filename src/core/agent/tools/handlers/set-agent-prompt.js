import { setAgentPrompt } from "#core/apc/agent-write.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Replace an existing agent's system prompt (the body of its `.md`), keeping
// every frontmatter field. The native counterpart of `apx agent set --prompt`
// and the MCP `agent_set_prompt`, so the super-agent can rewrite an agent's
// instructions without shelling out or hand-editing the file.
export default {
  name: "set_agent_prompt",
  schema: {
    type: "function",
    function: {
      name: "set_agent_prompt",
      description:
        "Replace an existing project agent's system prompt (its instructions), keeping its name/role/skills/model. Use this to fix or rewrite what an agent does — not run_shell, not write_file on the .md. `system` is required and non-empty.",
      parameters: {
        type: "object",
        required: ["agent", "system"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          agent:   { type: "string", description: "Slug of the existing agent (from list_agents)." },
          system:  { type: "string", description: "The new full system prompt. REQUIRED, non-empty." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent, system } = {}) => {
    await requirePermission("set_agent_prompt", { dangerous: true, args: { agent, project } });
    if (!agent) return { error: "agent required" };
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      setAgentPrompt(p, agent, system);
      projects.rebuild(p.id);
      return { ok: true, agent, project: projectMeta(projects, p) };
    } catch (e) {
      return { error: e.message };
    }
  },
};
