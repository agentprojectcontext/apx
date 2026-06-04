import fs from "node:fs";
import path from "node:path";
import { resolveProject } from "../helpers.js";

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
    const file = path.join(p.path, ".apc", "agents", agent, "memory.md");
    if (!fs.existsSync(file)) return { error: `no memory.md for agent ${agent}` };
    return { body: fs.readFileSync(file, "utf8") };
  },
};
