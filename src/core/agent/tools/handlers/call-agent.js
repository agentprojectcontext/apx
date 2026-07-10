import { callEngine } from "#core/engines/index.js";
import { readAgents } from "#core/apc/parser.js";
import { agentScopedMemoryBlock } from "#core/memory/index.js";
import { buildAgentSystem, resolveProject } from "../helpers.js";

export default {
  name: "call_agent",
  schema: {
    type: "function",
    function: {
      name: "call_agent",
      description: "Run a one-shot prompt through a project agent's configured LLM engine.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "agent slug" },
          prompt: { type: "string" },
        },
        required: ["agent", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, globalConfig }) => async ({ project, agent: slug, prompt }) => {
    const p = resolveProject(projects, project);
    const agent = readAgents(p.path).find((a) => a.slug === slug);
    if (!agent) throw new Error(`agent ${slug} not found`);
    if (!agent.fields.Model) throw new Error(`agent ${slug} has no model`);

    const config = p.config || globalConfig;
    // Scoped RAG recall for this agent + its project, grounded in the prompt.
    const scopedMemory = await agentScopedMemoryBlock(prompt, { project: p, agent, config });

    const result = await callEngine({
      modelId: agent.fields.Model,
      system: buildAgentSystem(p, agent, {
        invocation: "engine",
        caller: "super_agent_tool",
        extraParts: scopedMemory ? [scopedMemory] : [],
      }),
      messages: [{ role: "user", content: prompt }],
      config,
    });
    p.logMessage({
      agent_slug: slug,
      channel: "engine",
      direction: "out",
      type: "agent",
      actor_id: slug,
      actor_kind: "agent",
      author: slug,
      body: result.text,
      meta: { invoked_by: "super_agent_tool", usage: result.usage },
    });
    return { text: result.text, usage: result.usage };
  },
};
