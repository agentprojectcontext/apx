import { callEngine } from "../engines/index.js";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "./tools/tool-call-parser.js";
import { resolveActiveModel, fallbackModels } from "./model-router.js";
import { MAX_TOOL_ITERS, ACK_ONLY_TOOLS, MAX_CONSECUTIVE_ACKS, TURN_ENDING_TOOLS } from "./constants.js";
import { pseudoToolSystem, shouldRetryWithPseudoTools } from "./tools/pseudo-tools.js";
import { filterToolSchemas } from "./tools-overlap.js";
import { isRetryableEngineError, shortRetryReason } from "./retry.js";

async function emitProgress(onEvent, event) {
  if (typeof onEvent !== "function") return;
  await onEvent(event);
}

function summarizeForTrace(r) {
  if (r === null || r === undefined) return r;
  const s = JSON.stringify(r);
  if (s.length <= 400) return r;
  return s.slice(0, 380) + "…(truncated)";
}

function fallbackFinalText(trace, error) {
  const lines = [
    "Tool execution completed, but the model failed while composing the final answer.",
    `Engine error: ${String(error?.message || error).slice(0, 220)}`,
    "Trace:",
  ];
  for (const item of trace.slice(-8)) {
    lines.push(`- ${item.tool}: ${previewTraceResult(item.result)}`);
  }
  return lines.join("\n");
}

// A leading greeting clause: "¡Hola Manu!", "Hola,", "Hi there!", "Buenas tardes…".
// Intentionally narrow — only the opening salutation up to its first terminator —
// so we never eat real content.
const LEADING_GREETING_RE =
  /^\s*[¡!]*\s*(hola+|holis?|buenas|buen[oa]s?\s+(d[ií]as|tardes|noches)|hey|hi|hello)\b[^.!?¡\n]*[.!?¡]*[\s,]*/i;

/** If `text` opens with a greeting, return it with that greeting removed; else null. */
function stripLeadingGreeting(text) {
  const m = String(text).match(LEADING_GREETING_RE);
  if (!m) return null;
  return String(text).slice(m[0].length).replace(/^\s+/, "");
}

function previewTraceResult(result) {
  if (result === null || result === undefined) return "ok";
  if (typeof result === "string") return result.slice(0, 180);
  if (result.error) return `error: ${String(result.error).slice(0, 180)}`;
  if (result.path) return String(result.path).slice(0, 180);
  if (result.content) return String(result.content).slice(0, 180);
  if (result.results) return JSON.stringify(result.results).slice(0, 180);
  return JSON.stringify(result).slice(0, 180);
}

// Loop-control tool injected when `completionContract` is on (coding surfaces).
// With toolChoice:"required" the model can no longer end a turn by emitting
// prose ("now I'll edit the file." → stop). It must EITHER call a real tool to
// take the next step, OR call `finish` to declare the task complete. This makes
// "keep going until done" enforceable by protocol structure — no language
// heuristics, so it works regardless of the reply language.
export const FINISH_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "finish",
    description:
      "Call this ONLY when the user's request is fully complete and no step " +
      "remains. Put your final answer / summary of what you did in `summary` " +
      "(in the user's language). If anything is still pending, do NOT call " +
      "finish — call the next tool and keep working instead.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Final answer or concise summary of the work completed.",
        },
      },
      required: ["summary"],
    },
  },
};

// Behavioral nudge appended to the system prompt for the ONE tool-free wrap-up
// step at the end of a turn (see the loop's `isFinalWrapUp`). This shapes
// BEHAVIOR only — it never dictates wording or supplies a canned/templated
// sentence. The reply the user sees is 100% model-authored and varies with
// what the model actually did this turn. We do NOT mention any "tool limit":
// the model just speaks from where it is. Critically it must not claim work it
// didn't do (weak models otherwise fabricate "all done").
const WRAPUP_NUDGE =
  "\n\n[Internal note — last step of this turn. No more tools will run now. " +
  "Reply in plain prose, in the user's language, from your own context: briefly " +
  "say what you actually accomplished so far (check the tool results above — do " +
  "NOT claim anything you didn't do), and if work is still pending, name what's " +
  "left and ask the user whether you should continue. Do not mention limits, " +
  "steps, or iterations — just talk naturally.]";

/**
 * Shared tool-calling agent loop used by super-agent and future surfaces.
 */
export async function runAgent({
  globalConfig,
  system,
  prompt,
  previousMessages = [],
  overrideModel = null,
  toolSchemas,
  makeToolHandlers,
  toolHandlerCtx,
  onEvent = null,
  signal,
  onToken = null,
  agentName = "apx",
  suppressTools = null, // optional list of tool names to remove from the registry
  // Per-reply output cap. Defaults to 512 (tuned for chit-chat + small tool
  // args on cheap-tier TPM budgets). Summarization callers raise this because
  // "thinking" models (gemini-2.5-flash) burn the budget reasoning and emit
  // empty text on dense input when it's too low.
  maxTokens = 512,
  // Max tool-loop iterations. Defaults to MAX_TOOL_ITERS (tuned for chit-chat
  // surfaces). The Code module raises this so a multi-step coding task can run
  // to completion (read → edit → run → verify …) instead of stopping early.
  maxIters = MAX_TOOL_ITERS,
  // Structural "keep going until done" contract for coding surfaces. When on:
  //   1. a `finish` tool is injected into the schema set, and
  //   2. toolChoice is forced to "required" on EVERY iteration,
  // so the model can only advance (call a tool) or stop (call finish) — it can
  // never end the turn by narrating the next step. Language-agnostic by design.
  completionContract = false,
}) {
  const routing = await resolveActiveModel(globalConfig, { overrideModel });
  // Mutable: lazy-retry can rotate to a different model mid-loop on 429/413/5xx.
  let activeModel = routing.modelId;

  // Build the chain to walk on retryable failures: everything in
  // fallbackModels() that isn't `activeModel` already AND wasn't already
  // marked unhealthy by resolveActiveModel(). No point retrying with Ollama
  // when /api/tags strict check just told us the model isn't pulled.
  const triedHealth = new Map(
    (routing.tried || []).map((t) => [t.modelId, t.healthy !== false])
  );
  const retryChain = fallbackModels(globalConfig).filter((m) => {
    if (m === activeModel) return false;
    if (triedHealth.get(m) === false) return false;
    return true;
  });

  if (routing.fromFallback) {
    await emitProgress(onEvent, {
      type: "model_routed",
      model: activeModel,
      provider: routing.provider,
      from_fallback: true,
      tried: routing.tried,
    });
  }

  // Suppression: callers (notably the routine runner) can disable tools whose
  // output would duplicate post_commands. We filter the schemas the engine
  // sees AND keep a deny-set so a model that hallucinates a suppressed tool
  // call gets a clear error rather than firing.
  let effectiveSchemas = Array.isArray(suppressTools) && suppressTools.length > 0
    ? filterToolSchemas(toolSchemas, suppressTools)
    : toolSchemas;
  const suppressed = new Set(Array.isArray(suppressTools) ? suppressTools : []);
  if (suppressed.size > 0) {
    await emitProgress(onEvent, {
      type: "tools_suppressed",
      tools: [...suppressed],
      reason: "post_commands_overlap",
    });
  }
  // Completion contract: only meaningful when there are real tools to choose
  // between. Inject `finish` so the model has a graceful way to end the turn
  // under toolChoice:"required".
  const useContract = completionContract && effectiveSchemas.length > 0;
  if (useContract) {
    effectiveSchemas = [...effectiveSchemas, FINISH_TOOL_SCHEMA];
  }

  const rawHandlers = makeToolHandlers(toolHandlerCtx);
  const handlers = suppressed.size > 0
    ? new Proxy(rawHandlers, {
        get(target, name) {
          if (typeof name === "string" && suppressed.has(name)) {
            return async () => ({
              error: `tool "${name}" is suppressed for this invocation (post_commands already cover this output channel)`,
            });
          }
          return target[name];
        },
      })
    : rawHandlers;

  // Lazy tools: when the super-agent runs a `discover_tools` activation, its
  // handler pushes the newly-revealed schemas onto session.pending. We drain
  // that queue into effectiveSchemas at the top of each iteration, so tools
  // activated on step N are callable from step N+1. No session → no-op.
  const toolSession = toolHandlerCtx?.toolSession || null;
  const drainPendingTools = () => {
    if (!toolSession || toolSession.pending.length === 0) return;
    const seen = new Set(
      effectiveSchemas.map((s) => s?.function?.name || s?.name)
    );
    const additions = [];
    for (const sc of toolSession.pending) {
      const n = sc?.function?.name || sc?.name;
      if (n && !seen.has(n)) { additions.push(sc); seen.add(n); }
    }
    toolSession.pending = [];
    if (additions.length > 0) effectiveSchemas = effectiveSchemas.concat(additions);
  };

  const conversation = [...previousMessages, { role: "user", content: prompt }];
  const trace = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let lastText = "";

  // Collapse repeated greetings within a single turn. A turn can produce several
  // text segments (pre-tool narration + final answer) and weaker models greet in
  // each one, so the user sees "¡Hola Manu!" twice. Keep the first greeting,
  // strip any later one. Belt-and-suspenders over the action-discipline prompt
  // rule (which strong models follow but gemini-flash et al. often ignore).
  let greetedThisTurn = false;
  const dedupeGreeting = (text) => {
    if (!text) return text;
    if (greetedThisTurn) {
      const stripped = stripLeadingGreeting(text);
      return stripped == null ? text : stripped;
    }
    if (LEADING_GREETING_RE.test(text)) greetedThisTurn = true;
    return text;
  };
  let usePseudoTools = false;
  let ackOnlyStreak = 0;
  // "Never end on silence": a model call that returns no tool calls AND no
  // usable text is a dud (weak models do this). We re-prompt instead of ending
  // the turn empty, and the retry does NOT consume an iteration of the tool
  // budget. Bounded so a model that only ever returns empty can't spin forever.
  let emptyRetries = 0;
  const MAX_EMPTY_RETRIES = 2;
  // Side-effect dedupe. Weaker models (Gemini especially) sometimes
  // re-emit the SAME tool call across iterations — e.g. send_telegram
  // three times with identical args, spamming the user. For tools
  // that mutate the world we remember the (name + args) signature and
  // short-circuit duplicates with a synthetic "already done" result
  // instead of re-running. Read-only tools are exempt (idempotent and
  // sometimes legitimately repeated, like list_tasks before/after).
  const sideEffectExecuted = new Map();
  const SIDE_EFFECT_TOOLS = new Set([
    "send_telegram",
    "create_task",
    "write_file",
    "edit_file",
    "run_shell",
    "call_runtime",
    "add_project",
    "set_identity",
  ]);
  const sideEffectSignature = (name, args) => {
    try {
      return `${name}:${JSON.stringify(args)}`;
    } catch {
      return `${name}:<unserializable>`;
    }
  };

  // Engine call wrapped with lazy retry: on 413/429/5xx/rate-limit/etc, try
  // the next model in `retryChain` instead of bubbling. Stops when the chain
  // is exhausted; non-retryable errors (auth, bad payload) throw immediately.
  // See spec/backlog/13 + src/core/agent/retry.js for the classifier.
  const tryCallEngine = async (params, { allowRetry = true } = {}) => {
    while (true) {
      try {
        return await callEngine({ ...params, modelId: activeModel });
      } catch (e) {
        if (!allowRetry || retryChain.length === 0 || !isRetryableEngineError(e)) throw e;
        const nextModel = retryChain.shift();
        await emitProgress(onEvent, {
          type: "engine_failed",
          model: activeModel,
          reason: shortRetryReason(e),
          retry_with: nextModel,
        });
        activeModel = nextModel;
        // After switching providers the pseudo-tools mode (Ollama-only) is no
        // longer relevant; reset so we use structured tools on the new model.
        if (usePseudoTools) usePseudoTools = false;
      }
    }
  };

  for (let iter = 0; iter < maxIters; iter++) {
    // Merge any tools activated via discover_tools on the previous iteration.
    drainPendingTools();
    // Final iteration of a non-contract turn: the model is out of action steps.
    // Rather than cut off silently mid-tool-call, we run ONE tool-free step so
    // the model writes a natural closing in its OWN words — what it did, what's
    // left, and (if anything remains) whether to continue. We change only the
    // STRUCTURE (no tools this step) + a behavioral nudge; the wording is
    // entirely the model's. Coding surfaces keep their finish-tool flow, so
    // this never applies under completionContract.
    const isFinalWrapUp =
      !useContract && effectiveSchemas.length > 0 && iter === maxIters - 1;
    await emitProgress(onEvent, {
      type: isFinalWrapUp ? "final_wrapup" : "model_start",
      iteration: iter + 1,
      model: activeModel,
    });
    const forceTool =
      !isFinalWrapUp &&
      effectiveSchemas.length > 0 &&
      (useContract ||
        (ackOnlyStreak > 0 && ackOnlyStreak <= MAX_CONSECUTIVE_ACKS));
    const baseSystem = usePseudoTools
      ? pseudoToolSystem(system, effectiveSchemas)
      : system;
    let result;
    try {
      result = await tryCallEngine({
        system: isFinalWrapUp ? baseSystem + WRAPUP_NUDGE : baseSystem,
        messages: conversation,
        config: globalConfig,
        // On the wrap-up step we withhold tools entirely so the model must
        // answer in prose — same as a real engine called with tools omitted.
        tools: (usePseudoTools || isFinalWrapUp) ? null : effectiveSchemas,
        toolChoice: (usePseudoTools || isFinalWrapUp) ? null : (forceTool ? "required" : "auto"),
        // Smaller cap by default: 1024 ate too much of the cheap-tier TPM
        // budget. The super-agent rarely emits long replies; tool args are
        // small. Summarization callers raise it via the maxTokens arg.
        maxTokens,
        signal,
        onToken: ((!forceTool || isFinalWrapUp) && onToken) ? onToken : null,
      });
    } catch (e) {
      if (usePseudoTools && /^ollama:/i.test(String(activeModel || "")) && /ollama\s+500/i.test(String(e?.message || "")) && trace.length > 0) {
        await emitProgress(onEvent, { type: "model_retry", reason: "ollama_final_response_500", iteration: iter + 1 });
        lastText = fallbackFinalText(trace, e);
        break;
      }
      if (!shouldRetryWithPseudoTools(activeModel, e, usePseudoTools)) throw e;
      usePseudoTools = true;
      await emitProgress(onEvent, { type: "model_retry", reason: "ollama_structured_tools_500", iteration: iter + 1 });
      result = await tryCallEngine({
        system: pseudoToolSystem(system, toolSchemas),
        messages: conversation,
        config: globalConfig,
        tools: null,
        toolChoice: null,
        maxTokens,
        signal,
        onToken: (iter > 0 && onToken) ? onToken : null,
      });
    }

    totalUsage.input_tokens += result.usage?.input_tokens || 0;
    totalUsage.output_tokens += result.usage?.output_tokens || 0;
    lastText = result.text || "";

    let toolCalls = result.tool_calls || (result.message && result.message.tool_calls) || null;

    if ((!toolCalls || toolCalls.length === 0) && lastText) {
      const pseudo = extractPseudoToolCalls(lastText);
      if (pseudo.length > 0) {
        toolCalls = pseudo;
        lastText = cleanTextOfPseudoToolCalls(lastText);
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      lastText = cleanTextOfPseudoToolCalls(lastText) || lastText;
      // Dud turn (no tools, no text): re-prompt instead of ending empty, and
      // don't let it cost an iteration of the tool budget. `iter -= 1` cancels
      // the loop's `iter++`; the emptyRetries cap stops an all-empty model from
      // looping forever (after which we break and the surface's last-resort
      // floor sends a non-silent reply).
      if (!String(lastText).trim() && emptyRetries < MAX_EMPTY_RETRIES) {
        emptyRetries += 1;
        await emitProgress(onEvent, { type: "empty_retry", iteration: iter + 1, attempt: emptyRetries });
        iter -= 1;
        continue;
      }
      break;
    }

    const visibleText = dedupeGreeting(cleanTextOfPseudoToolCalls(lastText).trim());
    if (visibleText) {
      await emitProgress(onEvent, { type: "assistant_text", text: visibleText, iteration: iter + 1 });
    }

    conversation.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: toolCalls,
    });

    let finishSummary = null;
    let turnEndingQuestions = null;
    for (const tc of toolCalls) {
      const fn = tc.function || tc;
      const name = fn.name;
      let args = fn.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      args = args || {};

      // Completion contract: `finish` declares the task done. Capture its
      // summary as the final text and stop processing the rest of this turn.
      if (name === "finish") {
        finishSummary = typeof args.summary === "string" ? args.summary : "";
        break;
      }

      let toolResult;
      const traceId = `${iter + 1}:${trace.length + 1}`;
      await emitProgress(onEvent, {
        type: "tool_start",
        trace: { id: traceId, tool: name, args, pending: true },
        iteration: iter + 1,
      });
      // Dedupe identical side-effecting calls within this turn.
      const sig = SIDE_EFFECT_TOOLS.has(name) ? sideEffectSignature(name, args) : null;
      if (sig && sideEffectExecuted.has(sig)) {
        toolResult = {
          ok: true,
          deduped: true,
          note: `Ya ejecuté "${name}" con estos mismos argumentos en este turno; no lo repito.`,
          previous: sideEffectExecuted.get(sig),
        };
        await emitProgress(onEvent, {
          type: "tool_deduped",
          trace: { id: traceId, tool: name, args },
          iteration: iter + 1,
        });
      } else {
        try {
          const handler = handlers[name];
          toolResult = handler ? await handler(args) : { error: `unknown tool: ${name}` };
        } catch (e) {
          toolResult = { error: e.message };
        }
        if (sig) sideEffectExecuted.set(sig, summarizeForTrace(toolResult));
      }

      const traceItem = { id: traceId, tool: name, args, result: summarizeForTrace(toolResult) };
      trace.push(traceItem);
      await emitProgress(onEvent, { type: "tool_result", trace: traceItem, iteration: iter + 1 });

      // Groq (and strict OpenAI) require tool_call_id to be present and
      // match the id of the tool_call in the previous assistant message.
      // Real engines populate it; the pseudo-tool parser also assigns one
      // (`pseudo_<…>`). Either way, surface it on the tool result message
      // — otherwise Groq returns 400 "tool_call_id is missing".
      conversation.push({
        role: "tool",
        tool_call_id: tc.id || `synth_${iter}_${trace.length}`,
        tool_name: name,
        content: JSON.stringify(toolResult),
      });

      // Capture turn-ending intents (e.g. ask_questions). The loop cannot
      // legitimately advance without a user reply; under completionContract
      // forcing another tool call just produces ask_questions spam.
      if (TURN_ENDING_TOOLS.has(name) && !turnEndingQuestions) {
        // Questions may be plain strings (legacy) or {question, options, ...}.
        // For the assistant_text fallback we only need the prompt strings.
        const qs = Array.isArray(args.questions)
          ? args.questions
              .map((q) => (typeof q === "string" ? q : q && typeof q.question === "string" ? q.question : null))
              .filter(Boolean)
          : [];
        turnEndingQuestions = qs;
      }
    }

    // Task declared complete via the contract — emit the summary as the final
    // assistant text and exit the loop.
    if (finishSummary !== null) {
      if (finishSummary) {
        lastText = dedupeGreeting(finishSummary) || "";
        if (lastText) await emitProgress(onEvent, { type: "assistant_text", text: lastText, iteration: iter + 1 });
      }
      break;
    }

    // ask_questions (or future turn-ending tools): the task is genuinely
    // blocked on user input. Exit the loop — completionContract or not,
    // asking again gets us nowhere. We deliberately do NOT emit a synthetic
    // assistant_text and we leave lastText empty so persistence and one-shot
    // API callers don't end up with a duplicate bullet list next to the
    // rendering surfaces' own UI (web AskQuestionsCard, terminal renderer,
    // telegram inline keyboard). The structured questions live on the tool
    // trace — that's the canonical source.
    if (turnEndingQuestions) {
      if (!lastText) lastText = "";
      break;
    }

    const allAckOnly = toolCalls.every((tc) => {
      const n = (tc.function?.name) || tc.name;
      return ACK_ONLY_TOOLS.has(n);
    });
    if (allAckOnly) {
      ackOnlyStreak += 1;
      await emitProgress(onEvent, { type: "ack_only_iter", iteration: iter + 1, streak: ackOnlyStreak });
    } else {
      ackOnlyStreak = 0;
    }
  }

  return {
    // Strip a final greeting if an earlier segment in this turn already greeted.
    text: dedupeGreeting(lastText),
    usage: totalUsage,
    name: agentName,
    trace,
    model: activeModel,
    routing,
  };
}
