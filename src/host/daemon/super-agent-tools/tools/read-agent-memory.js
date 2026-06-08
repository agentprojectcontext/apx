import fs from "node:fs";
import { resolveProject } from "../helpers.js";
import { agentMemoryPath, readAgentMemory } from "../../../../core/agent-memory.js";

export default {
  name: "read_agent_memory",
  schema: {
    type: "function",
    function: {
      name: "read_agent_memory",
      description: "Read an agent memory.md file from default or a project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "agent slug" },
        },
        required: ["agent"],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, agent }) => {
    const p = resolveProject(projects, project);
    const file = agentMemoryPath(p, agent);
    const body = readAgentMemory(p, agent);
    if (!body && !fs.existsSync(file)) return { error: `no memory.md for agent ${agent}` };
    return { body, path: file };
  },
};
