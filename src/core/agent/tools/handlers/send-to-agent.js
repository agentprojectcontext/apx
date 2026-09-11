import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import { messagePeer } from "#core/agent/a2a/delegate.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "send_to_agent",
  schema: {
    type: "function",
    function: {
      name: "send_to_agent",
      description:
        "Talk to another agent. Give it the agent's slug (or the super-agent's, " +
        "or a coding runtime's) and your message; you get their answer back, " +
        "plus the thread it lives on. Use it whenever you need something from " +
        "someone else — a hand-off, a question, a status the owner should hear " +
        "through them. Never shell out to `apx send` for this: that blocks your " +
        "whole turn until the other side finishes.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Who to write to: an agent slug from list_agents, the super-agent, " +
              "or a runtime (claude-code, codex, opencode…).",
          },
          message: {
            type: "string",
            description:
              "What you are telling them. Self-contained: they see the prior " +
              "turns of YOUR thread with them and nothing else of your work.",
          },
          project: { type: "string", description: "Whose roster to resolve `to` in. Defaults to yours." },
        },
        required: ["to", "message"],
      },
    },
  },
  makeHandler: ({ projects, globalConfig, plugins, registries, channelMeta }) => async ({ project, to, message }) => {
    const p = resolveProject(projects, project);
    // WHO is writing. A project agent's turn stamps its slug on the tool
    // context (core/agent/run-turn.js); the super-agent's does not, and there
    // it is the super-agent. Never taken from an argument: a sender the caller
    // can choose is a sender the caller can forge, and this writes to a thread
    // the owner reads as a record of who said what.
    const from = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
    if (to === from) throw new Error("that is you — send_to_agent is for reaching someone else");
    return messagePeer({
      project: p,
      to,
      body: message,
      from,
      config: p.config || globalConfig,
      projects,
      plugins,
      registries,
    });
  },
};
