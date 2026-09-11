import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import { messagePeer } from "#core/agent/a2a/delegate.js";
import { sendInBackground, MAX_BACKGROUND_DEPTH } from "#core/agent/a2a/background.js";
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
          background: {
            type: "boolean",
            description:
              "Leave it running instead of waiting. Default false: you wait, and their " +
              "answer is this tool's result. Set TRUE whenever you do not need their " +
              "answer to write your next sentence — a hand-off, a heads-up, a question " +
              "you can act on later. A peer's turn is a full tool loop that can take " +
              "many minutes, and waiting through it does nothing for you or the owner.",
          },
          wake_me: {
            type: "boolean",
            description:
              "Only with background. Default TRUE: when they answer, you are woken with " +
              "their reply as a new message on this same thread, and you carry on from " +
              "there. Set false ONLY for a pure notification you will never need an " +
              "answer to. Your context is NOT kept while you wait, so put everything " +
              "you will need to act on the reply into `message` itself.",
          },
        },
        required: ["to", "message"],
      },
    },
  },
  makeHandler: ({ projects, globalConfig, plugins, registries, channelMeta }) => async ({ project, to, message, background = false, wake_me = true }) => {
    const p = resolveProject(projects, project);
    // WHO is writing. A project agent's turn stamps its slug on the tool
    // context (core/agent/run-turn.js); the super-agent's does not, and there
    // it is the super-agent. Never taken from an argument: a sender the caller
    // can choose is a sender the caller can forge, and this writes to a thread
    // the owner reads as a record of who said what.
    const from = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
    if (to === from) throw new Error("that is you — send_to_agent is for reaching someone else");

    // How deep the chain already is. An a2a turn carries it (see
    // replyAsAgent); a turn that arrived some other way is the start of one.
    const depth = Number(channelMeta?.a2aDepth) || 0;
    const config = p.config || globalConfig;

    if (background) {
      return sendInBackground({
        project: p,
        from,
        to,
        body: message,
        // Default true, and deliberately so: the failure this tool exists to
        // prevent is an agent that hands work off and never learns what came
        // back. Silence is the expensive default, so it has to be asked for.
        wake: wake_me !== false,
        depth: depth + 1,
        config,
        projects,
        plugins,
        registries,
      });
    }

    // Blocking. Bounded by the same wall as the background path — a chain of
    // agents waiting on each other is no less a chain for being synchronous,
    // and this path had no limit at all.
    if (depth >= MAX_BACKGROUND_DEPTH) {
      return {
        error:
          `send_to_agent: hand-off depth limit (${MAX_BACKGROUND_DEPTH}) reached. ` +
          `This chain of agents passing work to each other has gone as far as it may. ` +
          `Answer with what you have instead of asking somebody else.`,
      };
    }

    return messagePeer({
      project: p,
      to,
      body: message,
      from,
      config,
      projects,
      plugins,
      registries,
      depth: depth + 1,
    });
  },
};
