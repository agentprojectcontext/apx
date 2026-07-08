// Sub-agents as a composable tool (OpenHands Task-tool pattern): the model
// delegates a self-contained chunk of work to an ISOLATED agent run — fresh
// conversation, same registry (minus user-interaction tools), runs to
// completion, and the final text comes back as this tool's observation.
import { TOOLS } from "../names.js";

// One level of nesting only: a sub-agent cannot spawn another sub-agent.
// Enough for delegation, and it hard-bounds the fan-out a confused model can
// create (depth 2 with a loop would be exponential).
const MAX_DEPTH = 1;
const DEFAULT_MAX_ITERS = 16;
const MAX_MAX_ITERS = 24;

// Withheld from the child: it has no path to the user (the parent relays), so
// user-interaction tools would either dead-end (ask_questions) or bypass the
// parent's narrative (send_telegram). run_subagent itself enforces MAX_DEPTH
// twice — suppression here, depth check in the handler.
const CHILD_SUPPRESSED_TOOLS = [
  TOOLS.RUN_SUBAGENT,
  TOOLS.ASK_QUESTIONS,
  TOOLS.SEND_TELEGRAM,
];

export default {
  name: TOOLS.RUN_SUBAGENT,

  schema: {
    type: "function",
    function: {
      name: TOOLS.RUN_SUBAGENT,
      description:
        "Spawn an isolated sub-agent for a self-contained task and return its " +
        "result. The sub-agent starts with a FRESH context (it does not see " +
        "this conversation), gets the regular tool registry minus " +
        "user-interaction tools, works until done and hands back its final " +
        "answer. Use it to delegate a bounded chunk of work (research a " +
        "question, refactor a file, produce a summary) while you keep the main " +
        "thread. The prompt MUST be self-contained: include file paths, " +
        "constraints and every piece of context the sub-agent needs.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Full, self-contained task for the sub-agent.",
          },
          description: {
            type: "string",
            description: "Short (3-5 word) label for the task.",
          },
          max_iters: {
            type: "integer",
            description: `Optional tool-step budget (default ${DEFAULT_MAX_ITERS}, max ${MAX_MAX_ITERS}).`,
          },
        },
        required: ["prompt"],
      },
    },
  },

  makeHandler: (ctx) => async ({ prompt, description, max_iters } = {}) => {
    if (!prompt || !String(prompt).trim()) {
      return { error: "run_subagent: prompt is required" };
    }
    const depth = Number(ctx.subagentDepth) || 0;
    if (depth >= MAX_DEPTH) {
      return {
        error:
          "run_subagent: nesting limit reached — a sub-agent cannot spawn another sub-agent. Do the work directly.",
      };
    }

    // Dynamic import: registry → this handler → super-agent → registry would
    // otherwise be a static ESM cycle.
    const { runSuperAgent } = await import("#core/agent/super-agent.js");

    const parsed = parseInt(max_iters, 10);
    const maxIters = Math.min(
      Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_MAX_ITERS, 2),
      MAX_MAX_ITERS
    );

    const started = Date.now();
    try {
      const result = await runSuperAgent({
        globalConfig: ctx.globalConfig,
        projects: ctx.projects,
        plugins: ctx.plugins,
        registries: ctx.registries,
        prompt: String(prompt),
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        previousMessages: [],
        // Confirmations still reach the human: the child inherits the parent's
        // channel adapter, so a risky child action pauses the same dialog.
        requestConfirmation: ctx.requestConfirmation || null,
        suppressTools: CHILD_SUPPRESSED_TOOLS,
        maxIters,
        // Delegation semantics: the child works until it declares done via
        // `finish` — it can't end its run by narrating the next step.
        completionContract: true,
        subagentDepth: depth + 1,
      });
      return {
        ok: true,
        ...(description ? { description } : {}),
        text: result.text || "",
        steps: Array.isArray(result.trace) ? result.trace.length : 0,
        model: result.model,
        usage: result.usage,
        duration_ms: Date.now() - started,
      };
    } catch (e) {
      return { error: `run_subagent failed: ${e.message}` };
    }
  },
};
