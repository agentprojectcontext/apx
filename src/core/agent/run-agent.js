import { callEngine } from "../engines/index.js";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "./tool-call-parser.js";
import { resolveActiveModel, fallbackModels } from "./model-router.js";
import { MAX_TOOL_ITERS, ACK_ONLY_TOOLS, MAX_CONSECUTIVE_ACKS } from "./constants.js";
import {
  isShortConfirmation,
  lastAssistantAskedForConfirmation,
  isGhostResponse,
  looksLikeActionRequest,
} from "./ghost-guard.js";
import { pseudoToolSystem, shouldRetryWithPseudoTools } from "./pseudo-tools.js";
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

function previewTraceResult(result) {
  if (result === null || result === undefined) return "ok";
  if (typeof result === "string") return result.slice(0, 180);
  if (result.error) return `error: ${String(result.error).slice(0, 180)}`;
  if (result.path) return String(result.path).slice(0, 180);
  if (result.content) return String(result.content).slice(0, 180);
  if (result.results) return JSON.stringify(result.results).slice(0, 180);
  return JSON.stringify(result).slice(0, 180);
}

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
  const effectiveSchemas = Array.isArray(suppressTools) && suppressTools.length > 0
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

  const rawHandlers = makeToolHandlers({
    ...toolHandlerCtx,
    implicitConfirmation:
      isShortConfirmation(prompt) && lastAssistantAskedForConfirmation(previousMessages),
  });
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

  const conversation = [...previousMessages, { role: "user", content: prompt }];
  const trace = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let lastText = "";
  let usePseudoTools = false;
  let ackOnlyStreak = 0;

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

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    await emitProgress(onEvent, { type: "model_start", iteration: iter + 1, model: activeModel });
    // Force a tool call on iter 0 ONLY when the user message looks like a real
    // action request ("listame…", "mandá…", "buscá…"). For chit-chat ("hola",
    // "qué tal") forcing a tool makes weaker models (llama-3.3 via Groq,
    // qwen3-32b) emit a malformed tool_calls payload — Groq then rejects the
    // whole turn with 400 "Failed to call a function". Better: let the model
    // choose between text and tool when the prompt is conversational.
    const forceTool =
      (iter === 0 && looksLikeActionRequest(prompt)) ||
      (ackOnlyStreak > 0 && ackOnlyStreak <= MAX_CONSECUTIVE_ACKS);
    let result;
    try {
      result = await tryCallEngine({
        system: usePseudoTools ? pseudoToolSystem(system, effectiveSchemas) : system,
        messages: conversation,
        config: globalConfig,
        tools: usePseudoTools ? null : effectiveSchemas,
        toolChoice: usePseudoTools ? null : (forceTool ? "required" : "auto"),
        // Smaller cap: 1024 ate too much of the cheap-tier TPM budget. The
        // super-agent rarely emits long replies; tool args are small. If a
        // routine needs more, it can override via its spec.
        maxTokens: 512,
        signal,
        onToken: (!forceTool && onToken) ? onToken : null,
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
        maxTokens: 512,
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
      if (iter === 0 && isGhostResponse(lastText) && looksLikeActionRequest(prompt)) {
        await emitProgress(onEvent, { type: "ghost_response_detected", text: lastText });
        conversation.push({ role: "assistant", content: lastText });
        conversation.push({
          role: "user",
          content:
            "Remember: you must execute the action, not just confirm it. " +
            "Call the tool now — action first, report after.",
        });
        continue;
      }
      lastText = cleanTextOfPseudoToolCalls(lastText) || lastText;
      break;
    }

    const visibleText = cleanTextOfPseudoToolCalls(lastText).trim();
    if (visibleText) {
      await emitProgress(onEvent, { type: "assistant_text", text: visibleText, iteration: iter + 1 });
    }

    conversation.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function || tc;
      const name = fn.name;
      let args = fn.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      args = args || {};

      let toolResult;
      const traceId = `${iter + 1}:${trace.length + 1}`;
      await emitProgress(onEvent, {
        type: "tool_start",
        trace: { id: traceId, tool: name, args, pending: true },
        iteration: iter + 1,
      });
      try {
        const handler = handlers[name];
        toolResult = handler ? await handler(args) : { error: `unknown tool: ${name}` };
      } catch (e) {
        toolResult = { error: e.message };
      }

      const traceItem = { id: traceId, tool: name, args, result: summarizeForTrace(toolResult) };
      trace.push(traceItem);
      await emitProgress(onEvent, { type: "tool_result", trace: traceItem, iteration: iter + 1 });

      conversation.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(toolResult),
      });
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
    text: lastText,
    usage: totalUsage,
    name: agentName,
    trace,
    model: activeModel,
    routing,
  };
}
