import { callEngine } from "../engines/index.js";
import {
  extractPseudoToolCalls,
  extractBareFunctionCalls,
  cleanTextOfPseudoToolCalls,
  looksLikeFabricatedToolLog,
} from "./tools/tool-call-parser.js";
import { resolveActiveModel, fallbackModels } from "./model-router.js";
import { MAX_TOOL_ITERS, ACK_ONLY_TOOLS, MAX_CONSECUTIVE_ACKS, TURN_ENDING_TOOLS } from "./constants.js";
import { TOOLS } from "./tools/names.js";
import { pseudoToolSystem, shouldRetryWithPseudoTools } from "./tools/pseudo-tools.js";
import { filterToolSchemas } from "./tools-overlap.js";
import { buildRuntimeBlock } from "./prompt-builder.js";
import { isRetryableEngineError, shortRetryReason } from "./retry.js";
import {
  securityRiskConfig,
  withSecurityRiskField,
  popSecurityRisk,
  shouldConfirmRisk,
} from "./security.js";
import { buildConfirmDescription } from "../confirmation/index.js";
import { PERMISSION_MODES } from "../constants/permissions.js";
import {
  stuckDetectionConfig,
  createStuckDetector,
  stuckNudgeSignal,
} from "./stuck-detector.js";
import { createGreetingGuard } from "./loop/greeting-guard.js";
import { createSideEffectLedger } from "./loop/side-effects.js";
import {
  describeTurnImages,
  providerWiresVision,
  withImageDescription,
} from "./vision-bridge.js";

async function emitProgress(onEvent, event) {
  if (typeof onEvent !== "function") return;
  await onEvent(event);
}

// How much of one tool result the trace carries. The trace is what gets
// PERSISTED (message store, web viewer) and what the next turns replay as
// history, so this cap is the memory a past tool call leaves behind.
const TRACE_RESULT_CAP = 1200;
// Longest single string field kept inside a structured result.
const TRACE_FIELD_CAP = 900;

// Shrink a tool result for the trace WITHOUT destroying its shape. The old
// version stringified anything over 400 chars and sliced the JSON text, which
// left a half-open brace: unparseable, so every downstream reader (history
// replay, viewer) had to show escaped JSON instead of the actual output. Now
// the envelope survives and only the long string fields inside are clipped —
// `{ exit_code, stdout }` stays an object whose stdout is trimmed.
function summarizeForTrace(r) {
  if (r === null || r === undefined) return r;
  if (typeof r === "string") {
    return r.length <= TRACE_RESULT_CAP ? r : r.slice(0, TRACE_RESULT_CAP) + "…(truncated)";
  }
  if (typeof r !== "object") return r;
  try {
    if (JSON.stringify(r).length <= TRACE_RESULT_CAP) return r;
  } catch {
    return String(r).slice(0, TRACE_RESULT_CAP);
  }
  const clip = (v, depth) => {
    if (typeof v === "string") {
      return v.length <= TRACE_FIELD_CAP ? v : v.slice(0, TRACE_FIELD_CAP) + "…(truncated)";
    }
    if (Array.isArray(v)) {
      const head = v.slice(0, 20).map((x) => clip(x, depth + 1));
      return v.length > 20 ? [...head, `…(${v.length - 20} more)`] : head;
    }
    if (v && typeof v === "object") {
      if (depth >= 3) return "…(nested)";
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, depth + 1)]));
    }
    return v;
  };
  return clip(r, 0);
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

/**
 * Did the engine stop because it ran out of output budget? Every adapter passes
 * the provider's own word through: OpenAI-shaped gateways say "length", Gemini
 * says "MAX_TOKENS".
 */
function wasTruncated(result) {
  return /^(length|max_tokens)$/i.test(String(result?.finish_reason || ""));
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
    name: TOOLS.FINISH,
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

// In-band signal injected as a CONVERSATION turn (not a system suffix) for the
// ONE tool-free wrap-up step at the end of a turn (see the loop's
// `isFinalWrapUp`). Delivering it through the message channel — the way a tool
// result arrives — makes weak models reliably author a reply instead of
// returning empty, because they always answer the latest turn. It shapes
// BEHAVIOR only: it never dictates wording or supplies a canned sentence. The
// reply the user sees is 100% model-authored and varies with what the model
// actually did this turn. Critically it must not claim work it didn't do (weak
// models otherwise fabricate "all done").
//
// Unlike a hard "iteration limit" message, it asks the model to surface the
// situation NATURALLY ("this is taking more steps than I expected") plus a
// concrete recap of what it found and did NOT find — so the closing reads like
// a human status update, never robotic system jargon.
const WRAPUP_SIGNAL =
  "[Internal turn note — this is NOT from the user. You've taken several tool " +
  "steps this turn and the task isn't finished; no more tools will run now. " +
  "Write the user ONE short, natural closing message, in their language, " +
  "entirely in your own words:\n" +
  "- Concretely recap what you actually did and what you found so far — and be " +
  "honest about what you did NOT find or couldn't resolve yet. Read the tool " +
  "results above; do not claim anything you didn't do.\n" +
  "- Mention plainly that this is taking more steps than expected and isn't done.\n" +
  "- Ask whether they want you to keep going.\n" +
  "Talk like a person giving a quick status update. Do NOT emit a tool call, " +
  "JSON, or system jargon like \"iteration\" or \"limit\".]";

// How many times one turn may be nudged past an output-limit truncation before
// we let it end. A model that answers with a wall of prose every time is not
// going to start acting on the third try, and the wrap-up still fires.
const MAX_LENGTH_CONTINUES = 2;

// A model that hits its output cap mid-sentence has not finished; it has been
// cut off. Every adapter reports that as a finish reason, and the loop used to
// ignore it: no tool calls in a truncated message means "the model stopped
// calling tools", which reads as a completed turn. So a routine that wrote six
// ideas out as YAML instead of filing them, ran out of budget halfway through
// the sixth, and never called the tool, reported `status: ok` with a reply that
// began mid-word.
//
// This note goes in as a conversation turn so weak models actually answer it,
// and it asks for the ACTION rather than a shorter essay — writing the work out
// is what filled the budget in the first place.
const TRUNCATED_SIGNAL =
  "[Internal turn note — this is NOT from the user. Your last message hit the " +
  "output limit and was cut off mid-way, so nothing in it counted as work.\n" +
  "Do NOT rewrite or continue that text. If the task needs tools — creating a " +
  "task, writing a file, sending a message — CALL THEM NOW, one step at a time, " +
  "and keep any prose to a single short line. Composing the result as text is " +
  "not the same as doing it.]";

// A turn that WROTE tool results instead of producing them.
//
// The shipped example (2026-08-29, Telegram): a fallback model answered with
// five `[result: shell]` lines — invented commands, invented output — and then
// "Listo, te mandé el WhatsApp". No tool ran. The user was told a message had
// been sent to a real phone number that was never sent.
//
// Nothing in those lines can be recovered: there is no structured call in them,
// and reconstructing a shell command from hallucinated prose to run it for real
// would be a far worse failure than the one it fixes. So the model is told the
// results are not real and asked to do the work — the same in-band correction
// the truncation case uses, and for the same reason (weak models answer a
// conversation turn far more reliably than a system suffix).
const FABRICATED_RESULTS_SIGNAL =
  "[Internal turn note — this is NOT from the user. Your last message was " +
  "written as if tools had run, but you called none, so none of those results " +
  "exist and nothing you described actually happened.\n" +
  "Lines like `[tool result: …]` in this conversation are a LOG of past calls. " +
  "They are not a format for you to write in — writing one does not run " +
  "anything.\n" +
  "Do the work now: emit real tool calls, one step at a time. If you cannot " +
  "(no such tool, missing permission, unclear arguments), say that plainly to " +
  "the user instead — but never report an action you did not take.]";

// How many times one turn may be corrected for this before we let it end. A
// model that fabricates twice in a row is not going to start acting on the
// third try, and the wrap-up still fires.
const MAX_FABRICATION_RETRIES = 2;

/**
 * Shared tool-calling agent loop used by super-agent and future surfaces.
 */
export async function runAgent({
  globalConfig,
  system,
  prompt,
  previousMessages = [],
  // Files that arrived with this turn: [{ kind, mime, data (base64), path }].
  // Channel handlers (e.g. an inbound Telegram photo) populate it.
  attachments = [],
  overrideModel = null,
  // Content-routed model for this turn (selectModelByRules). Unlike
  // overrideModel it is health-checked and falls back down the chain.
  preferredModel = null,
  toolSchemas,
  makeToolHandlers,
  toolHandlerCtx,
  onEvent = null,
  signal,
  onToken = null,
  onReasoningToken = null,
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
  const routing = await resolveActiveModel(globalConfig, { overrideModel, preferredModel });
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

  if (routing.fromFallback || routing.routedBy) {
    await emitProgress(onEvent, {
      type: "model_routed",
      model: activeModel,
      provider: routing.provider,
      from_fallback: routing.fromFallback === true,
      ...(routing.routedBy ? { routed_by: routing.routedBy } : {}),
      tried: routing.tried,
    });
  }

  // Suppression: callers (notably the routine runner) can disable tools whose
  // output would duplicate a sink the run already has — a post_command, or the
  // routine's own `deliver_to`. We filter the schemas the engine
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
      // Why, generically: a post_command pipes this output somewhere, or the
      // routine's `deliver_to` does. Either way the sink already owns the
      // message and the loop must not send a second one.
      reason: "output_sink_overlap",
    });
  }
  // Completion contract: only meaningful when there are real tools to choose
  // between. Inject `finish` so the model has a graceful way to end the turn
  // under toolChoice:"required".
  const useContract = completionContract && effectiveSchemas.length > 0;
  if (useContract) {
    effectiveSchemas = [...effectiveSchemas, FINISH_TOOL_SCHEMA];
  }

  // Inline security-risk analysis: every eligible tool schema gains a required
  // `security_risk` enum the model fills as part of the call itself (no second
  // LLM pass). The loop extracts the grade below and the ConfirmRisky policy
  // decides whether the call pauses for human approval.
  const riskCfg = securityRiskConfig(globalConfig);
  const permissionMode = globalConfig?.super_agent?.permission_mode || "";
  const riskGateOn = riskCfg.enabled;
  // In `total` (full trust) the risk gate acts ONLY as a safety floor: HIGH-risk
  // actions still confirm, everything below runs free. That's the value the
  // permission mode alone can't give — it gates by tool identity, this gates by
  // the model's own judgment of THIS action's severity. In automatico/permiso
  // the configured confirm_at applies.
  const effectiveRiskCfg =
    permissionMode === PERMISSION_MODES.TOTAL
      ? { ...riskCfg, confirm_at: "HIGH", confirm_unknown: false }
      : riskCfg;
  if (riskGateOn) {
    effectiveSchemas = withSecurityRiskField(effectiveSchemas);
    // Handshake with createPermissionGuard: outside `total`, the analyzer owns
    // dangerous-call gating so the static dangerous-flag branch stands down.
    // (In `total` the guard returns early anyway, so this is a no-op there.)
    if (toolHandlerCtx) toolHandlerCtx.securityRiskActive = true;
  }
  // Telegram (and any other abortable surface) kills in-flight shell tools
  // when a newer turn supersedes this one. Handlers read it at call time.
  if (toolHandlerCtx && signal) toolHandlerCtx.abortSignal = signal;

  const rawHandlers = makeToolHandlers(toolHandlerCtx);
  const handlers = suppressed.size > 0
    ? new Proxy(rawHandlers, {
        get(target, name) {
          if (typeof name === "string" && suppressed.has(name)) {
            return async () => ({
              error: `tool "${name}" is suppressed for this invocation (this run already delivers to that channel)`,
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

  const schemaOnTheWire = (n) =>
    effectiveSchemas.some((sc) => (sc?.function?.name || sc?.name) === n);

  /**
   * A tool the model called WITHOUT ever receiving its schema.
   *
   * buildLazyToolsBlock puts the NAMES of not-loaded tools in the system prompt
   * (that is what makes them discoverable), and not every provider refuses a
   * call to a tool that was never in the request. So the model can name a real
   * tool and invent its arguments, and the handler will happily run them:
   * `complete_task` was called as `{project, id}` — `id` is what list_tasks
   * hands back, the schema says `task`, and `action` was missing entirely — and
   * "task required" told the model nothing it could act on. It burned three
   * iterations and left the task open.
   *
   * Activating and returning the schema costs one step and makes the retry
   * informed. It also closes a gap: the role gate (`allowedTools`) only ever
   * filtered the schemas the model was SENT, so a guessed name walked straight
   * past it into the handler map, which holds every tool regardless.
   */
  const revealUnloadedTool = (session, name) => {
    const r = session.activate({ names: [name] });
    if (r.denied?.length) return { error: `tool "${name}" is not available to you` };
    if (r.unknown?.length) return { error: `unknown tool: ${name}` };
    const schema = session.pending.find((sc) => (sc?.function?.name || sc?.name) === name);
    return {
      error: `tool "${name}" was not loaded, so you called it without its schema — nothing ran.`,
      activated: name,
      schema: schema?.function || schema || null,
      note: "Ya está cargada. Llamala de nuevo usando exactamente los parámetros de arriba.",
    };
  };

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
    if (additions.length > 0) {
      effectiveSchemas = effectiveSchemas.concat(
        riskGateOn ? withSecurityRiskField(additions) : additions
      );
    }
  };

  // Attachments ride on THIS turn's user message. Multimodal engines (Gemini,
  // Claude, GPT via OpenAI-shaped wire) get the pixels. Text-only engines
  // (zen:big-pickle and most free Zen models) get a short description from the
  // vision bridge instead — otherwise the agent only sees "[image attached —
  // saved to …]" and roleplays that the photo never arrived.
  const turnImages = attachments.filter((a) => a?.data && /^image\//.test(a.mime || ""));
  let turnPrompt = prompt;
  let imagesForModel = turnImages;
  if (turnImages.length && !providerWiresVision(activeModel)) {
    const description = await describeTurnImages(turnImages, globalConfig, { signal });
    if (description) {
      turnPrompt = withImageDescription(prompt, description);
      await emitProgress(onEvent, {
        type: "vision_bridged",
        model: activeModel,
        images: turnImages.length,
      });
    }
    // Do not put raw bytes on the wire for text-only providers — Zen free
    // models 400 or silently drop them (see vision-bridge.js).
    imagesForModel = [];
  }
  const conversation = [
    ...previousMessages,
    {
      role: "user",
      content: turnPrompt,
      ...(imagesForModel.length > 0 ? { images: imagesForModel } : {}),
    },
  ];
  const trace = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let lastText = "";

  // Collapse repeated greetings within a single turn. A turn can produce several
  // text segments (pre-tool narration + final answer) and weaker models greet in
  // each one, so the user sees "¡Hola Manu!" twice. Keep the first greeting,
  // strip any later one. Belt-and-suspenders over the action-discipline prompt
  // rule (which strong models follow but gemini-flash et al. often ignore).
  const greetingGuard = createGreetingGuard();
  const dedupeGreeting = (text) => greetingGuard.apply(text);
  let usePseudoTools = false;
  let ackOnlyStreak = 0;
  // "Never end on silence": a model call that returns no tool calls AND no
  // usable text is a dud (weak models do this). We re-prompt instead of ending
  // the turn empty, and the retry does NOT consume an iteration of the tool
  // budget. Bounded so a model that only ever returns empty can't spin forever.
  let emptyRetries = 0;
  let lengthContinues = 0;
  let fabricationRetries = 0;
  const MAX_EMPTY_RETRIES = 2;
  // Side-effect dedupe. Weaker models (Gemini especially) sometimes
  // re-emit the SAME tool call across iterations — e.g. send_telegram
  // three times with identical args, spamming the user. For tools
  // that mutate the world we remember the (name + args) signature and
  // short-circuit duplicates with a synthetic "already done" result
  // instead of re-running. Read-only tools are exempt (idempotent and
  // sometimes legitimately repeated, like list_tasks before/after).
  const sideEffects = createSideEffectLedger();

  // Stuck detection: catches the loops the side-effect dedupe can't — a
  // read-only call repeated with identical results, or the same call erroring
  // over and over. First trigger = in-band nudge; second = force the tool-free
  // wrap-up so the turn closes with a model-authored status instead of burning
  // the rest of the budget.
  const stuckCfg = stuckDetectionConfig(globalConfig);
  const stuckDetector = createStuckDetector(stuckCfg);
  let stuckNudged = false;
  let forceWrapUp = false;
  // Set when the turn closed on the reserved wrap-up step (budget exhausted, or
  // stuck-aborted). The wrap-up ASKS the user whether to keep going, so such a
  // turn is waiting on a person — exactly like ask_questions — not unfinished.
  // Callers that would otherwise "continue" it (the judge loop) must not, or the
  // user gets the same recap and the same question again every round without
  // ever being given the chance to answer it.
  let endedAwaitingUser = false;
  const safeSig = (v) => {
    try {
      return JSON.stringify(v) ?? "";
    } catch {
      return "<unserializable>";
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
        if (signal?.aborted || e?.name === "AbortError") throw e;
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
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    // Merge any tools activated via discover_tools on the previous iteration.
    drainPendingTools();
    // Final iteration of a non-contract turn: the model is out of action steps.
    // Rather than cut off silently mid-tool-call, we run ONE tool-free step so
    // the model writes a natural closing in its OWN words — what it did, what's
    // left, and (if anything remains) whether to continue. We change only the
    // STRUCTURE (no tools this step) + an in-band directive turn (WRAPUP_SIGNAL);
    // the wording is entirely the model's. Coding surfaces keep their finish-tool flow, so
    // this never applies under completionContract.
    // forceWrapUp (stuck abort) overrides the contract: a stuck model under
    // toolChoice:"required" would only repeat itself, so we withhold tools and
    // make it close the turn in prose either way.
    const isFinalWrapUp =
      effectiveSchemas.length > 0 &&
      ((!useContract && iter === maxIters - 1) || forceWrapUp);
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
    // Built per iteration, not per turn: the fallback router can rotate
    // providers mid-turn, and a line that named the model we STARTED on would
    // be exactly the kind of stale fact this block exists to kill.
    const runtime = buildRuntimeBlock(activeModel);
    const systemForCall = runtime ? `${system}\n\n${runtime}` : system;
    const baseSystem = usePseudoTools
      ? pseudoToolSystem(systemForCall, effectiveSchemas)
      : systemForCall;
    let result;
    try {
      result = await tryCallEngine({
        system: baseSystem,
        // Wrap-up: deliver the "you're out of steps, summarize + ask" directive
        // as the latest CONVERSATION turn so the model treats it like any other
        // turn it must answer — far more reliable than a system suffix on weak
        // models. Ephemeral: built fresh here, never persisted to history.
        messages: isFinalWrapUp
          ? [...conversation, { role: "user", content: WRAPUP_SIGNAL }]
          : conversation,
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
        onReasoningToken: ((!forceTool || isFinalWrapUp) && onReasoningToken) ? onReasoningToken : null,
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
        onReasoningToken: (iter > 0 && onReasoningToken) ? onReasoningToken : null,
      });
    }

    totalUsage.input_tokens += result.usage?.input_tokens || 0;
    totalUsage.output_tokens += result.usage?.output_tokens || 0;

    // The model thinking out loud. Adapters keep it out of `text` so no
    // surface can leak it by forgetting to strip; it rides its own event for
    // the ones that want to show it on purpose, and is ignored by the rest.
    if (result.reasoning) {
      await emitProgress(onEvent, {
        type: "assistant_reasoning",
        reasoning: result.reasoning,
        iteration: iter + 1,
      });
    }

    lastText = result.text || "";

    let toolCalls = result.tool_calls || (result.message && result.message.tool_calls) || null;

    // Names callable on THIS turn. Passed to the bare-call parser as an
    // allow-list: without it, a model merely explaining `create_task({...})`
    // in prose would have it executed for real.
    const callableNames = effectiveSchemas
      .map((s2) => s2?.function?.name || s2?.name)
      .filter(Boolean);

    if ((!toolCalls || toolCalls.length === 0) && lastText) {
      const pseudo = extractPseudoToolCalls(lastText);
      // A model that writes `create_task({...})` as prose MEANT to call it. It
      // then tells the user it did — so either we run it or the user is lied
      // to. See the header of extractBareFunctionCalls.
      const bare = pseudo.length ? [] : extractBareFunctionCalls(lastText, callableNames);
      const recovered = pseudo.length ? pseudo : bare;
      if (recovered.length > 0) {
        toolCalls = recovered;
        lastText = cleanTextOfPseudoToolCalls(lastText, callableNames);
        await emitProgress(onEvent, {
          type: "tool_calls_recovered",
          from: pseudo.length ? "pseudo" : "bare_text",
          model: activeModel,
          tools: recovered.map((c) => c.function?.name).filter(Boolean),
        });
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      // Checked BEFORE the cleaner, which is what strips the evidence.
      const fabricated =
        effectiveSchemas.length > 0 && looksLikeFabricatedToolLog(lastText);
      lastText = cleanTextOfPseudoToolCalls(lastText, callableNames) || lastText;
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
      // It narrated the tools instead of calling them. Do NOT let this text
      // stand as the answer — it reports work that never happened. The
      // fabricated turn goes into the history so the model can see what it is
      // being corrected about, followed by the correction.
      if (fabricated && fabricationRetries < MAX_FABRICATION_RETRIES) {
        fabricationRetries += 1;
        await emitProgress(onEvent, {
          type: "fabricated_results",
          model: activeModel,
          iteration: iter + 1,
          attempt: fabricationRetries,
        });
        conversation.push({ role: "assistant", content: lastText });
        conversation.push({ role: "user", content: FABRICATED_RESULTS_SIGNAL });
        continue;
      }
      // Cut off at the output cap, not finished. Keep the truncated text in the
      // history (so the model can see what it was doing) and ask for the action.
      if (wasTruncated(result) && lengthContinues < MAX_LENGTH_CONTINUES) {
        lengthContinues += 1;
        await emitProgress(onEvent, {
          type: "truncated_continue",
          iteration: iter + 1,
          attempt: lengthContinues,
        });
        conversation.push({ role: "assistant", content: lastText });
        conversation.push({ role: "user", content: TRUNCATED_SIGNAL });
        continue;
      }
      // The text we just took as the answer IS the wrap-up: it ends by asking
      // the user whether to continue. Tell the caller so nobody answers on
      // their behalf.
      if (isFinalWrapUp) endedAwaitingUser = true;
      break;
    }

    const visibleText = dedupeGreeting(cleanTextOfPseudoToolCalls(lastText, callableNames).trim());
    if (visibleText) {
      await emitProgress(onEvent, { type: "assistant_text", text: visibleText, iteration: iter + 1 });
    }

    conversation.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: toolCalls,
      // Gemini thinking-model fidelity: carry the raw parts array from the
      // engine response so toGeminiContents() can replay the model turn
      // verbatim (thought parts + thoughtSignatures + functionCalls) on the
      // next request, avoiding the 400 "missing thought_signature" error.
      // Other engines return undefined here, so this field is a no-op for them.
      ...(result._geminiRawParts ? { _geminiRawParts: result._geminiRawParts } : {}),
      // Same idea for the OpenAI-shaped reasoners: DeepSeek's thinking mode
      // rejects a replayed assistant turn that lost its `reasoning_content`.
      // Stored under an underscore so only the adapters that ask for it put it
      // back on the wire (see zen.js modelReplaysReasoning).
      ...(result.reasoning ? { _reasoning: result.reasoning } : {}),
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
      // Pop the model's own risk grade BEFORE the handler sees the args — the
      // field belongs to the loop, not to any tool's contract.
      const securityRisk = riskGateOn ? popSecurityRisk(args) : null;

      // Completion contract: `finish` declares the task done. Capture its
      // summary as the final text and stop processing the rest of this turn.
      if (name === TOOLS.FINISH) {
        finishSummary = typeof args.summary === "string" ? args.summary : "";
        break;
      }

      let toolResult;
      const traceId = `${iter + 1}:${trace.length + 1}`;
      await emitProgress(onEvent, {
        type: "tool_start",
        trace: {
          id: traceId,
          tool: name,
          args,
          pending: true,
          ...(securityRisk ? { security_risk: securityRisk } : {}),
        },
        iteration: iter + 1,
      });
      // Dedupe identical side-effecting calls within this turn — and, for the
      // ones a PERSON reads, calls that only differ in how they were worded.
      // A model relaying something re-words it every time it repeats itself,
      // so exact args alone let three "same" messages through (see
      // loop/side-effects.js).
      const sig = sideEffects.signature(name, args);
      const restated = sideEffects.seen(sig) ? null : sideEffects.nearDuplicate(name, args);
      if (sideEffects.seen(sig) || restated) {
        toolResult = {
          ok: true,
          deduped: true,
          note: restated
            ? `Ya dije esto mismo con "${name}" en este turno; no lo repito.`
            : `Ya ejecuté "${name}" con estos mismos argumentos en este turno; no lo repito.`,
          previous: restated || sideEffects.previous(sig),
        };
        await emitProgress(onEvent, {
          type: "tool_deduped",
          trace: { id: traceId, tool: name, args },
          iteration: iter + 1,
        });
      } else {
        // ConfirmRisky gate: pause on the model's own grade before executing.
        // A decline becomes a normal error observation — the model sees the
        // rejection and can re-plan, mirroring OpenHands' rejection flow.
        let riskDenied = null;
        if (riskGateOn && shouldConfirmRisk(securityRisk, effectiveRiskCfg)) {
          const description = buildConfirmDescription(name, args);
          const requestConfirmation = toolHandlerCtx?.requestConfirmation;
          if (typeof requestConfirmation !== "function") {
            riskDenied = `Action requires user confirmation (security risk ${securityRisk}): ${description}`;
          } else {
            await emitProgress(onEvent, {
              type: "security_confirmation",
              trace: { id: traceId, tool: name, risk: securityRisk },
              iteration: iter + 1,
            });
            let approved = false;
            try {
              approved = await requestConfirmation(name, args, `[risk: ${securityRisk}] ${description}`);
            } catch {
              approved = false;
            }
            if (approved && toolHandlerCtx) toolHandlerCtx.securityGateCleared = true;
            if (!approved) {
              riskDenied = `User did not confirm (security risk ${securityRisk}): ${description}`;
            }
          }
        }
        if (riskDenied) {
          toolResult = { error: riskDenied };
        } else {
          try {
            const handler = handlers[name];
            if (!handler) toolResult = { error: `unknown tool: ${name}` };
            // Suppression comes first: a suppressed tool was REMOVED from the
            // schema set on purpose, and telling the model it merely wasn't
            // loaded would invite it to activate the tool and send twice.
            else if (toolSession && !suppressed.has(name) && !schemaOnTheWire(name)) {
              toolResult = revealUnloadedTool(toolSession, name);
            }
            else toolResult = await handler(args);
          } catch (e) {
            toolResult = { error: e.message };
          } finally {
            if (toolHandlerCtx) toolHandlerCtx.securityGateCleared = false;
          }
        }
        sideEffects.record(sig, summarizeForTrace(toolResult), { name, args });
      }

      // A tool may return images for the MODEL to see (view_media loads a skill
      // photo so the model can reason about a position). Lift them off the
      // result and onto the tool message as `images`, so the engine sends them
      // as multimodal parts — and keep the base64 OUT of the trace and the JSON
      // content the model re-reads as text (a dumped data URI there is both a
      // token bomb and a worked example of pasting base64 into prose).
      let toolImages = null;
      if (toolResult && typeof toolResult === "object" && Array.isArray(toolResult.images)) {
        const usable = toolResult.images.filter((im) => im && im.data && im.mime);
        if (usable.length) toolImages = usable;
        const { images, ...rest } = toolResult;
        toolResult = { ...rest, ...(toolImages ? { images_attached: toolImages.length } : {}) };
      }

      const traceItem = {
        id: traceId,
        tool: name,
        args,
        result: summarizeForTrace(toolResult),
        ...(securityRisk ? { security_risk: securityRisk } : {}),
      };
      trace.push(traceItem);
      await emitProgress(onEvent, { type: "tool_result", trace: traceItem, iteration: iter + 1 });

      stuckDetector.record({
        tool: name,
        argsSig: safeSig(args),
        resultSig: safeSig(traceItem.result),
        isError: !!(toolResult && typeof toolResult === "object" && toolResult.error),
      });

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
        // Multimodal tool results (view_media): carried beside the JSON so a
        // vision engine renders them as inlineData parts. Text engines drop it.
        ...(toolImages ? { images: toolImages } : {}),
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

    // Stuck escalation: first detection nudges (in-band note, detector reset so
    // only FRESH repetitions count again); a second detection means the nudge
    // didn't land — stop spending budget and force the wrap-up close.
    const stuck = stuckDetector.check();
    if (stuck) {
      if (!stuckNudged) {
        stuckNudged = true;
        stuckDetector.reset();
        await emitProgress(onEvent, { type: "stuck_detected", ...stuck, iteration: iter + 1 });
        conversation.push({ role: "user", content: stuckNudgeSignal(stuck) });
      } else {
        await emitProgress(onEvent, { type: "stuck_abort", ...stuck, iteration: iter + 1 });
        forceWrapUp = true;
      }
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
    // True when the turn closed on the reserved wrap-up — it asked the user a
    // question and the next move is theirs. See endedAwaitingUser above.
    endedAwaitingUser,
  };
}
