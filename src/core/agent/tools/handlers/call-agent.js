import { callEngineWithFallback } from "#core/agent/engine-call.js";
import { readAgents } from "#core/apc/parser.js";
import { agentScopedMemoryBlock } from "#core/memory/index.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
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

    const config = p.config || globalConfig;
    const modelId = await resolveAgentModel({ agent, config });
    if (!modelId) throw new Error(`no model for agent ${slug} (no override, no router default)`);

    // Scoped RAG recall for this agent + its project, grounded in the prompt.
    const scopedMemory = await agentScopedMemoryBlock(prompt, { project: p, agent, config });

    // Same fallback chain the agent loop walks. Without it a provider hiccup
    // on the delegated call — a Zen 429 the caller's own turn would have
    // rotated past without noticing — came back as a hard failure.
    const result = await callEngineWithFallback({
      modelId,
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
      meta: { invoked_by: "super_agent_tool", usage: result.usage, model: result.model },
    });
    // `model` is the one that ANSWERED — after a rotation it is not the one
    // that was asked, and a caller reporting back should say which.
    return { text: result.text, usage: result.usage, model: result.model };
  },
};
