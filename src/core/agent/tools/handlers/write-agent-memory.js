import { appendAgentMemory, writeAgentMemory } from "#core/agent/memory.js";
import { readAgents } from "#core/apc/parser.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Write ANOTHER agent's memory (~/.apx/projects/<id>/agents/<slug>/memory.md).
// Distinct from `remember`, which writes the super-agent's OWN notebook: this
// seeds or updates a project agent's memory so it can track progress across
// runs (e.g. a coach recording which topics it has already taught). Append is
// the default; `mode: "replace"` overwrites the whole file.
export default {
  name: "write_agent_memory",
  schema: {
    type: "function",
    function: {
      name: "write_agent_memory",
      description:
        "Write a note into a PROJECT AGENT's own memory.md (not your own notebook — that's `remember`). Use it to seed or update what another agent knows across runs. Default mode appends a dated line under '## Recent context'; mode 'replace' overwrites the whole file. Give the agent slug (from list_agents).",
      parameters: {
        type: "object",
        required: ["agent", "content"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          agent:   { type: "string", description: "Slug of the agent whose memory to write (from list_agents)." },
          content: { type: "string", description: "The note (append mode) or the full memory body (replace mode)." },
          mode:    { type: "string", enum: ["append", "replace"], description: "append (default) adds a dated line under Recent context; replace overwrites." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent, content, mode = "append" } = {}) => {
    await requirePermission("write_agent_memory", { dangerous: true, args: { agent, project } });
    if (!agent) return { error: "agent required" };
    if (!content || !String(content).trim()) return { error: "content required" };
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    if (!readAgents(p.path).some((a) => a.slug === agent)) {
      return { error: `agent ${agent} not found in ${projectMeta(projects, p).name}` };
    }
    try {
      const path = mode === "replace"
        ? writeAgentMemory(p, agent, String(content))
        : appendAgentMemory(p, agent, String(content));
      return { ok: true, agent, mode, project: projectMeta(projects, p), path };
    } catch (e) {
      return { error: e.message };
    }
  },
};
