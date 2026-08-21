import { removeAgent } from "#core/apc/agent-write.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Delete a project agent — its definition and its runtime dir (memory,
// conversations, sessions). Completes the agent CRUD next to create_agent /
// set_agent_prompt / configure_agent so the super-agent never shells out.
export default {
  name: "remove_agent",
  schema: {
    type: "function",
    function: {
      name: "remove_agent",
      description:
        "Delete a project agent: removes its .apc/agents/<slug>.md definition AND its runtime data (memory, conversations, sessions). Irreversible. Confirm with the user first unless they clearly asked to delete it.",
      parameters: {
        type: "object",
        required: ["agent"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          agent:   { type: "string", description: "Slug of the agent to delete (from list_agents)." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent } = {}) => {
    await requirePermission("remove_agent", { dangerous: true, args: { agent, project } });
    if (!agent) return { error: "agent required" };
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      removeAgent(p, agent);
      projects.rebuild(p.id);
      return { ok: true, removed: agent, project: projectMeta(projects, p) };
    } catch (e) {
      return { error: e.message };
    }
  },
};
