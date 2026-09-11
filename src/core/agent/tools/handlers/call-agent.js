import { readAgents } from "#core/apc/parser.js";
import { delegateToAgent } from "#core/agent/a2a/delegate.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "call_agent",
  schema: {
    type: "function",
    function: {
      name: "call_agent",
      description:
        "Hand a piece of work to a project agent and get its answer. The agent " +
        "runs with its own tools and its own memory of this exchange, so it can " +
        "actually do the work — read the repo, open the task, write the file — " +
        "not just describe it. The exchange is filed as an agent-to-agent " +
        "conversation the owner can read and continue, and the thread id comes " +
        "back so you can say where it is.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "agent slug" },
          prompt: {
            type: "string",
            description:
              "The task, self-contained. The agent sees the prior turns of THIS " +
              "delegation thread and nothing else of your conversation.",
          },
        },
        required: ["agent", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, globalConfig, plugins, registries }) => async ({ project, agent: slug, prompt }) => {
    const p = resolveProject(projects, project);
    const agent = readAgents(p.path).find((a) => a.slug === slug);
    if (!agent) throw new Error(`agent ${slug} not found`);

    // Everything else — the model, the tool loop, the system prompt, the two
    // ledger rows that make this a readable thread — is the a2a path's, which
    // is the same one `apx send --deliver` walks. This tool is the super-agent's
    // door into it, not a second implementation of it.
    return delegateToAgent({
      project: p,
      agent,
      prompt,
      config: p.config || globalConfig,
      projects,
      plugins,
      registries,
    });
  },
};
