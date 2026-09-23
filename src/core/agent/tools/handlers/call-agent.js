import { readAgents } from "#core/apc/parser.js";
import { isUnwatchedTurn } from "#core/agent/quota.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import { delegateToAgent } from "#core/agent/a2a/delegate.js";
import { MAX_BACKGROUND_DEPTH } from "#core/agent/a2a/background.js";
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
  makeHandler: ({ projects, globalConfig, plugins, registries, channel, channelMeta }) => async ({ project, agent: slug, prompt }) => {
    const p = resolveProject(projects, project);
    const agent = readAgents(p.path).find((a) => a.slug === slug);
    if (!agent) throw new Error(`agent ${slug} not found`);
    // WHO is calling. Every project agent has this tool too, not only the
    // super-agent, and without this the thread was filed as `super_agent`
    // whoever made the call: Kai asked Bridget something, Bridget answered
    // "Hola Roby", and the owner read a conversation that never happened.
    // Same source as send_to_agent — the turn's stamp, never an argument.
    const from = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
    if (slug === from) throw new Error("that is you — call_agent is for reaching someone else");
    // The chain counts here too. Without it a delegation restarted every
    // chain at depth 0, and the depth wall only held for send_to_agent.
    const depth = Number(channelMeta?.a2aDepth) || 0;
    if (depth + 1 >= MAX_BACKGROUND_DEPTH) {
      return {
        error:
          `call_agent: hand-off depth limit (${MAX_BACKGROUND_DEPTH}) reached. ` +
          `This chain of agents passing work to each other has gone as far as it may. ` +
          `Answer with what you have instead of asking somebody else.`,
      };
    }

    // Everything else — the model, the tool loop, the system prompt, the two
    // ledger rows that make this a readable thread — is the a2a path's, which
    // is the same one `apx send --deliver` walks. This tool is the super-agent's
    // door into it, not a second implementation of it.
    return delegateToAgent({
      project: p,
      agent,
      prompt,
      from,
      depth: depth + 1,
      // call_agent blocks: from a turn somebody is watching, the owner is
      // waiting on this answer — their request, not background spend.
      watched: !isUnwatchedTurn(channel, channelMeta),
      config: p.config || globalConfig,
      projects,
      plugins,
      registries,
    });
  },
};
