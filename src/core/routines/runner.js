// Routine execution — the domain logic any caller can invoke (daemon
// scheduler, CLI `apx routine run`, HTTP `/api/projects/:pid/routines/:name/run`,
// MCP server, future scripts). The runner orchestrates a 3-phase pipeline:
//   1. pre_commands  (shell)
//   2. handler       (heartbeat / exec_agent / super_agent / telegram / shell / watch)
//   3. post_commands (shell)
//
// `runRoutineNow(ctx, routine)` is the single entry point. Pass a ctx with at
// least { project, projects, plugins, registries, globalConfig }. The runner
// is process-state free — the daemon's RoutineScheduler is a separate file
// (host/daemon/routines-scheduler.js) that just polls and calls this.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { callEngine } from "#core/engines/index.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { runAgent, computeSuppressedTools } from "#core/agent/index.js";
import { TELEGRAM_TOOL_ITERS } from "#core/agent/constants.js";
import { createToolSession, makeToolHandlers } from "#core/agent/tools/registry.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { resolveAgentAllowedTools } from "#core/agent/agent-tools.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import {
  startConversation,
  appendTurn,
  setStatus,
} from "#core/stores/conversations.js";
import { resolveArtifactRef, ARTIFACTS_SKIP_SIGNAL } from "#core/stores/artifacts.js";
import {
  ensureRoutineMemory,
  readRoutineMemoryForPrompt,
  routineMemoryPath,
} from "#core/stores/routine-memory.js";
import { CHANNELS } from "#core/constants/channels.js";
import { detectSignals, formatSignals, peakSeverity, thresholdsFromConfig } from "#core/routines/signals.js";
import { readActiveProfile, effectiveProfileConfig } from "#core/profiles/store.js";
import {
  updateRunState,
  parseSchedule,
  computeNextRun,
} from "#core/stores/routines.js";
import { nowIso } from "#core/util/time.js";

// --------------------- handlers ---------------------------------------------

async function handleHeartbeat(ctx, routine) {
  const { project } = ctx;
  const channel = routine.spec.channel || "heartbeat";
  const message = routine.spec.message || `heartbeat from ${routine.name}`;
  project.logMessage({
    channel,
    direction: "out",
    type: "system",
    actor_id: "apx:routine",
    author: "apx",
    body: message,
    meta: { routine: routine.name },
  });
  return { status: "ok", note: `logged to messages on channel '${channel}'` };
}

async function handleExecAgent(ctx, routine) {
  const { project, globalConfig, projects, plugins, registries } = ctx;
  const { agent: slug, prompt } = routine.spec;
  if (!slug || !prompt) throw new Error("exec_agent: spec needs { agent, prompt }");

  const agents = readAgents(project.path);
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) throw new Error(`agent ${slug} not found`);
  const config = project.config || globalConfig;
  const model = await resolveAgentModel({ agent, config });
  if (!model) throw new Error(`no model for agent ${slug} (no override, no router default)`);

  // Explicit opt-out ONLY. `spec.no_tools: true` keeps the old one-shot text
  // path (weather-style "write a sentence, post_commands send it").
  //
  // An empty `allowed_tools` used to count as that opt-out, and it is also what
  // the store writes when nobody specified any — `apx routine add` without
  // `--allowed-tools` produced `[]`. So every routine created the obvious way
  // silently ran with NO tools: the agent could not read a file, reach Asana or
  // write its ledger, and the "answer" was a model narrating work it never did.
  // The two states are now distinct: `[]` means "no override, use the agent's
  // declared tools", and refusing tools altogether is something you have to say.
  const noTools = routine.spec?.no_tools === true;
  // Only a NON-EMPTY list overrides the agent's own declared tools.
  const toolOverride =
    Array.isArray(routine.allowed_tools) && routine.allowed_tools.length > 0
      ? routine.allowed_tools
      : undefined;

  const system = buildAgentSystem(project, agent, {
    invocation: "routine",
    routine: routine.name,
    channel: CHANNELS.ROUTINE,
    globalConfig: config,
  });

  let text = "";
  let trace = [];
  let usage = null;
  let allowedTools = [];

  if (noTools) {
    const result = await callEngine({
      modelId: model,
      system,
      messages: [{ role: "user", content: prompt }],
      config,
    });
    text = result.text || "";
    usage = result.usage;
  } else {
    const cfg = structuredClone(config || {});
    cfg.super_agent = {
      ...(config?.super_agent || {}),
      // A scheduled run has no human to click Confirm. Default to total so
      // a Magui-style cron can edit its ledger; pin permission_mode on the
      // routine itself to lock it down.
      permission_mode: routine.permission_mode || "total",
      ...(toolOverride ? { allowed_tools: toolOverride } : {}),
    };
    const autoSuppress = computeSuppressedTools(routine.post_commands);
    const explicitSuppress = Array.isArray(routine.spec?.suppress_tools)
      ? routine.spec.suppress_tools.filter((s) => typeof s === "string")
      : [];
    const suppressTools = [...new Set([...autoSuppress, ...explicitSuppress])];
    allowedTools = resolveAgentAllowedTools(agent, { override: toolOverride });
    const toolSession = createToolSession(CHANNELS.ROUTINE, { allowedTools });

    const result = await runAgent({
      globalConfig: cfg,
      system,
      prompt,
      overrideModel: model,
      toolSchemas: toolSession.initialSchemas,
      makeToolHandlers,
      toolHandlerCtx: {
        projects,
        plugins,
        registries,
        globalConfig: cfg,
        channel: CHANNELS.ROUTINE,
        channelMeta: {
          routineName: routine.name,
          routineId: routine.id || "",
          projectPath: project.path,
        },
        toolSession,
        requestConfirmation: null,
      },
      agentName: slug,
      suppressTools: suppressTools.length > 0 ? suppressTools : null,
      maxIters: TELEGRAM_TOOL_ITERS,
      maxTokens: 2048,
    });
    text = result.text || "";
    trace = Array.isArray(result.trace) ? result.trace : [];
    usage = result.usage;

    const blocked = blockedForPermission(trace);
    if (blocked.length) {
      const conversationId = persistRoutineConversation({
        storagePath: project.storagePath,
        slug,
        model,
        prompt,
        reply: text,
        trace,
        routineName: routine.name,
      });
      logRoutineChat(project, {
        slug, prompt, reply: text, trace, usage, model,
        routineName: routine.name, conversationId,
      });
      return {
        status: "error",
        error:
          `blocked waiting for a confirmation nobody can give: ${blocked.join(", ")}. ` +
          `A scheduled run has no one to approve a dangerous tool — either allow it on ` +
          `this routine (allowed_tools) or use a tool that does not need approval.`,
        blocked_tools: blocked,
        reply: text,
        trace,
        agent_slug: slug,
        conversation_id: conversationId,
        allowed_tools: allowedTools,
      };
    }
  }

  const conversationId = persistRoutineConversation({
    storagePath: project.storagePath,
    slug,
    model,
    prompt,
    reply: text,
    trace,
    routineName: routine.name,
  });
  logRoutineChat(project, {
    slug, prompt, reply: text, trace, usage, model,
    routineName: routine.name, conversationId,
  });
  return {
    status: "ok",
    reply: text,
    trace,
    agent_slug: slug,
    conversation_id: conversationId,
    allowed_tools: allowedTools,
    usage,
  };
}

/** One conversation file per run so the chat list / inbox can reopen it. */
function persistRoutineConversation({ storagePath, slug, model, prompt, reply, trace, routineName }) {
  if (!storagePath || !slug) return null;
  try {
    const conv = startConversation({
      storagePath,
      agentSlug: slug,
      engine: model,
      channel: CHANNELS.ROUTINE,
      title: routineName,
    });
    appendTurn({
      filePath: conv.path,
      role: "user",
      content: `[routine: ${routineName}]\n\n${prompt}`,
    });
    for (const item of Array.isArray(trace) ? trace : []) {
      if (!item?.tool) continue;
      appendTurn({
        filePath: conv.path,
        role: "tool",
        content: JSON.stringify({
          tool: item.tool,
          args: item.args || {},
          result: item.result,
        }),
      });
    }
    appendTurn({ filePath: conv.path, role: "assistant", content: reply || "" });
    setStatus(conv.path, "closed");
    return conv.id;
  } catch {
    return null;
  }
}

function logRoutineChat(project, { slug, prompt, reply, trace, usage, model, routineName, conversationId }) {
  if (!project?.logMessage) return;
  const scope = {
    routine: routineName,
    ...(conversationId ? { conversation: conversationId } : {}),
  };
  project.logMessage({
    agent_slug: slug,
    channel: CHANNELS.ROUTINE,
    direction: "in",
    type: "user",
    author: "user",
    body: prompt,
    meta: scope,
  });
  for (const item of Array.isArray(trace) ? trace : []) {
    if (!item?.tool) continue;
    project.logMessage({
      agent_slug: slug,
      channel: CHANNELS.ROUTINE,
      direction: "out",
      type: "tool",
      actor_id: item.tool,
      actor_kind: "tool",
      author: slug,
      body: `${item.tool}(${JSON.stringify(item.args || {}).slice(0, 200)})`,
      meta: { ...scope, tool: item.tool, args: item.args, result: item.result },
    });
  }
  const toolSummary = summarizeToolTrace(trace);
  project.logMessage({
    agent_slug: slug,
    channel: CHANNELS.ROUTINE,
    direction: "out",
    type: "agent",
    actor_id: slug,
    actor_kind: "agent",
    author: slug,
    body: reply || "",
    meta: {
      ...scope,
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(toolSummary ? { tool_summary: toolSummary } : {}),
      ...(trace?.length ? { tool_trace: trace } : {}),
    },
  });
}

async function handleSuperAgent(ctx, routine, extraChannelMeta = {}) {
  const { project, globalConfig, projects, plugins, registries } = ctx;
  const { prompt } = routine.spec;
  if (!prompt) throw new Error("super_agent: spec needs { prompt }");

  const cfg = structuredClone(globalConfig || {});
  cfg.super_agent = {
    ...(globalConfig?.super_agent || {}),
    ...(routine.permission_mode ? { permission_mode: routine.permission_mode } : {}),
    // Same rule as exec_agent: an empty list is the store's default, not a
    // deliberate "no tools".
    ...(routine.allowed_tools?.length ? { allowed_tools: routine.allowed_tools } : {}),
  };

  // Auto-suppress tools whose output would duplicate post_commands.
  // Example: a routine with `apx telegram send "$APX_LLM_OUTPUT"` in post_commands
  // shouldn't also let the agent call send_telegram inside the loop.
  // See spec/backlog/01-routine-output-coherence.md.
  const autoSuppress = computeSuppressedTools(routine.post_commands);
  const explicitSuppress = Array.isArray(routine.spec?.suppress_tools)
    ? routine.spec.suppress_tools.filter((s) => typeof s === "string")
    : [];
  const suppressTools = [...new Set([...autoSuppress, ...explicitSuppress])];

  const result = await runSuperAgent({
    globalConfig: cfg,
    projects,
    plugins,
    registries,
    prompt,
    channel: CHANNELS.ROUTINE,
    channelMeta: {
      routineName: routine.name,
      routineId: routine.id || "",
      routineSchedule: routine.schedule || "",
      routineLastRun: routine.last_run || "",
      routineMemoryPath: (() => {
        try {
          ensureRoutineMemory(project.storagePath || project.path, routine.id, routine.name);
          return routineMemoryPath(project.storagePath || project.path, routine.id);
        } catch { return ""; }
      })(),
      routineMemory: (() => {
        try {
          return readRoutineMemoryForPrompt(project.storagePath || project.path, routine.id);
        } catch { return ""; }
      })(),
      projectPath: project.path,
      // An ANCHOR is a message the user put on the clock themselves. The
      // interruption budget exempts it from the daily ceiling — the profile
      // schema calls that number "the ceiling outside the anchors".
      ...(routine.spec?.anchor === true ? { scheduledByUser: true } : {}),
      ...extraChannelMeta,
    },
    suppressTools: suppressTools.length > 0 ? suppressTools : null,
  });

  // A tool that needed a human in a run with no human is a DEAD END, not a
  // hiccup: nobody is ever going to confirm it. Reporting the run as "ok"
  // meant the only symptom was silence — the evening anchor produced nothing
  // and it took twenty-one shell commands to work out why. Name it.
  const blocked = blockedForPermission(result.trace);

  project.logMessage({
    channel: CHANNELS.ROUTINE,
    direction: "out",
    type: "agent",
    actor_id: SUPERAGENT_ACTOR_ID,
    actor_kind: "superagent",
    author: result.name || resolveAgentName(globalConfig),
    body: result.text || "",
    meta: {
      routine: routine.name,
      tool_trace: result.trace,
      // Compact form too: the viewer renders this without parsing the trace.
      ...(summarizeToolTrace(result.trace) ? { tool_summary: summarizeToolTrace(result.trace) } : {}),
      usage: result.usage,
    },
  });
  if (blocked.length) {
    return {
      status: "error",
      error:
        `blocked waiting for a confirmation nobody can give: ${blocked.join(", ")}. ` +
        `A scheduled run has no one to approve a dangerous tool — either allow it on ` +
        `this routine (allowed_tools) or use a tool that does not need approval.`,
      blocked_tools: blocked,
      reply: result.text,
      trace: result.trace,
    };
  }
  return { status: "ok", reply: result.text, trace: result.trace };
}

/**
 * Tools whose result was "Action requires user confirmation" — the message
 * createPermissionGuard throws when there is no confirmation channel wired
 * (tools/helpers.js). Distinct from a tool that merely failed.
 */
export function blockedForPermission(trace) {
  const names = new Set();
  for (const item of Array.isArray(trace) ? trace : []) {
    const err = item?.result?.error;
    if (typeof err === "string" && /requires user confirmation/i.test(err)) {
      names.add(item.tool || "unknown");
    }
  }
  return [...names];
}

async function handleTelegram(ctx, routine) {
  const { plugins } = ctx;
  const tg = plugins?.get("telegram");
  if (!tg) throw new Error("telegram plugin not loaded");
  const { channel, chat_id, text } = routine.spec;
  if (!text) throw new Error("telegram routine needs spec.text");
  await tg.send({ channel, chat_id, text });
  // Return the (interpolated) text so the run detail can show what was sent.
  return { status: "ok", text };
}

function handleShell(ctx, routine) {
  return new Promise((resolve, reject) => {
    const { command, timeout_ms = 30_000 } = routine.spec;
    if (!command) return reject(new Error("shell routine needs spec.command"));
    const child = spawn("sh", ["-c", command], {
      cwd: ctx.project.path,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout_ms);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ status: "ok", stdout: stdout.trim().slice(0, 4000) });
      else resolve({ status: "error", code, stderr: stderr.trim().slice(0, 2000) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * watch — deterministic detection first, model second.
 *
 * THE WHOLE POINT: when nothing is happening this returns before any model is
 * touched. That is what makes it affordable to run every few minutes, and it
 * is the difference between a watcher and a cron job with a language model
 * bolted on. `tests/signals.test.js` asserts the no-signal path never reaches
 * runSuperAgent, because this property is invisible until the bill arrives.
 *
 * spec: { prompt, types?, thresholds?, projects? }
 */
async function handleWatch(ctx, routine) {
  const { projects, globalConfig } = ctx;
  const { prompt, types, thresholds } = routine.spec || {};
  if (!prompt) throw new Error("watch: spec needs { prompt } for the judgement step");

  // Thresholds come from the active profile — "stale after 7 days" is a
  // judgement about how someone works, not a constant — with the routine able
  // to override for its own narrower purpose.
  let profileConfig = {};
  try {
    const active = readActiveProfile(globalConfig);
    if (active) profileConfig = effectiveProfileConfig(active, globalConfig) || {};
  } catch { /* a broken profile must not take the watcher down */ }

  const entries = [];
  for (const entry of projects?.list?.() || []) {
    const p = projects.get(entry.id);
    if (!p?.storagePath) continue;
    entries.push({
      id: entry.id,
      name: entry.name || entry.path,
      path: entry.path,
      storagePath: p.storagePath,
    });
  }

  const { signals, skipped } = detectSignals(entries, {
    ...thresholdsFromConfig(profileConfig),
    ...(thresholds && typeof thresholds === "object" ? thresholds : {}),
    types: Array.isArray(types) ? types : [],
  });

  if (!signals.length) {
    // Terminates here. No model, no tokens, nothing sent.
    return {
      status: "ok",
      signals: 0,
      note: "no signals — did not invoke the model",
      ...(skipped.length ? { skipped } : {}),
    };
  }

  const enriched = {
    ...routine,
    spec: {
      ...routine.spec,
      prompt:
        `${prompt}\n\n` +
        `Signals detected (${signals.length}), highest severity ${peakSeverity(signals)}:\n` +
        `${formatSignals(signals)}\n\n` +
        "These were found deterministically — they are facts, not guesses. Your job is " +
        "judgement: decide whether any of it is worth interrupting for right now, and if " +
        "so say the one thing that matters. Staying quiet is a valid outcome.",
    },
  };

  // Severity travels with the run so the interruption budget can be told how
  // bad this is by a DETECTOR rather than by the model's own opinion of its
  // news. A model that can grade its own message as critical has a shouting
  // backdoor; a deterministic overdue commitment does not.
  const result = await handleSuperAgent(ctx, enriched, {
    signalSeverity: peakSeverity(signals),
    signalCount: signals.length,
  });
  return {
    ...result,
    signals: signals.length,
    peak_severity: peakSeverity(signals),
    signal_types: [...new Set(signals.map((s) => s.type))],
    ...(skipped.length ? { skipped } : {}),
  };
}

const HANDLERS = {
  heartbeat: handleHeartbeat,
  exec_agent: handleExecAgent,
  super_agent: handleSuperAgent,
  telegram: handleTelegram,
  shell: handleShell,
  watch: handleWatch,
};

// --------------------- pipeline: pre/post shell commands --------------------

/** Run a single shell command. Returns { exitCode, stdout, stderr }. */
function runShellCmd(cmd, env = {}, cwd = os.homedir()) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
    child.on("error", (e) => resolve({ exitCode: 1, stdout: "", stderr: e.message }));
  });
}

/** Inject {{pre_output}} into a prompt string. */
function injectPreOutput(prompt, preOutput) {
  if (!prompt || typeof prompt !== "string") return prompt;
  return prompt.replace(/\{\{pre_output\}\}/g, preOutput || "");
}

/** Decide whether to skip the LLM call based on skip_prompt_on + pre results. */
function shouldSkipPrompt(routine, preExitCode, preStdout) {
  const mode = routine.skip_prompt_on || "signal";
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (mode === "signal") return preStdout.includes(ARTIFACTS_SKIP_SIGNAL);
  if (mode === "pre_failure") return preExitCode !== 0;
  if (mode === "pre_success") return preExitCode === 0;
  return false;
}

// --------------------- runtime: run one routine -----------------------------

/**
 * Execute a single routine end-to-end (pre_commands → handler → post_commands)
 * and persist last-run state. Pure with respect to process lifecycle — does NOT
 * touch a timer, queue, or scheduler. Pure with respect to network — the
 * super-agent / telegram handlers obviously go out, but the orchestration is
 * sync from the caller's point of view via the returned promise.
 *
 * @param {object} ctx
 *   - project: ProjectManager entry (logMessage, path, storagePath)
 *   - projects, plugins, registries, globalConfig
 * @param {object} routine The routine record from core/stores/routines.js
 * @returns {object} { status, last_run_at, next_run_at, ...handler-result }
 */
export async function runRoutineNow(ctx, routine) {
  const cwd = ctx.project?.path || os.homedir();
  const storagePath = ctx.project?.storagePath || os.homedir();

  const hasPreCmds  = Array.isArray(routine.pre_commands)  && routine.pre_commands.length  > 0;
  const hasPostCmds = Array.isArray(routine.post_commands) && routine.post_commands.length > 0;

  let preStdout = "";
  let preExitCode = 0;
  let preOutputFile = null;

  // ── Phase 1: pre_commands ──────────────────────────────────────────────────
  if (hasPreCmds) {
    const combinedOut = [];
    for (const rawCmd of routine.pre_commands) {
      const cmd = resolveArtifactRef(rawCmd, storagePath);
      const { exitCode, stdout, stderr } = await runShellCmd(cmd, {}, cwd);
      combinedOut.push(stdout);
      if (stderr) combinedOut.push(stderr);
      preExitCode = exitCode;
      if (exitCode !== 0 && (routine.skip_prompt_on === "pre_failure" || routine.skip_prompt_on === "signal")) {
        break;
      }
    }
    preStdout = combinedOut.join("");

    try {
      preOutputFile = path.join(os.tmpdir(), `apx-pre-${routine.name}-${Date.now()}.txt`);
      fs.writeFileSync(preOutputFile, preStdout);
    } catch { preOutputFile = null; }
  }

  const pipelineEnv = {
    APX_PRE_EXIT: String(preExitCode),
    APX_PRE_OUTPUT: preStdout.slice(0, 32_000),
    APX_PRE_OUTPUT_FILE: preOutputFile || "",
    APX_ROUTINE: routine.name,
  };

  // ── Phase 2: LLM / handler ────────────────────────────────────────────────
  const skip = hasPreCmds && shouldSkipPrompt(routine, preExitCode, preStdout);

  let result = { status: "ok" };
  let status = "ok";
  let errMsg = null;

  if (!skip) {
    // Injected unconditionally, including when there is no pre output at all.
    // A routine that asks for {{pre_output}} and gets nothing must see an empty
    // slot, not the literal braces: a placeholder that survives into the prompt
    // reaches the model as text and it will dutifully try to make sense of it.
    // The replace is a no-op for the routines that never mention it.
    const enrichedRoutine = {
      ...routine,
      spec: {
        ...routine.spec,
        // {{pre_output}} works in both the LLM prompt and the telegram text.
        // Keys the spec does not have stay absent — a `prompt: undefined` on a
        // shell routine would be a new shape for every reader downstream.
        ...(typeof routine.spec?.prompt === "string" ? { prompt: injectPreOutput(routine.spec.prompt, preStdout) } : {}),
        ...(typeof routine.spec?.text === "string" ? { text: injectPreOutput(routine.spec.text, preStdout) } : {}),
      },
    };

    const handler = HANDLERS[enrichedRoutine.kind];
    if (!handler) {
      status = "error";
      errMsg = `unknown routine kind: ${enrichedRoutine.kind}`;
    } else {
      try {
        result = await handler(ctx, enrichedRoutine);
        if (result?.status === "error") {
          status = "error";
          errMsg = result.error || result.stderr || `routine ${routine.name} returned error status`;
        }
      } catch (e) {
        status = "error";
        errMsg = e.message;
        result = { status: "error", error: e.message };
      }
    }
  } else {
    result = { status: "ok", skipped: true, note: "pre_commands signalled skip" };
  }

  // ── Phase 3: post_commands ────────────────────────────────────────────────
  const postRuns = [];
  if (hasPostCmds) {
    const llmOutput = result?.reply || result?.text || "";
    const postEnv = {
      ...pipelineEnv,
      APX_LLM_OUTPUT: llmOutput.slice(0, 32_000),
      APX_STATUS: status,
      APX_SKIPPED: skip ? "1" : "0",
    };
    for (const rawCmd of routine.post_commands) {
      const cmd = resolveArtifactRef(rawCmd, storagePath);
      const r = await runShellCmd(cmd, postEnv, cwd);
      postRuns.push({ cmd: rawCmd, exit: r.exitCode, stdout: (r.stdout || "").slice(0, 4000), stderr: (r.stderr || "").slice(0, 2000) });
    }
  }

  if (preOutputFile) try { fs.unlinkSync(preOutputFile); } catch {}

  const lastRun = nowIso();
  const next = computeNextRun({ schedule: routine.schedule, last_run_at: lastRun });
  const isOnce = parseSchedule(routine.schedule).kind === "once";
  updateRunState(ctx.project.storagePath, routine.name, {
    last_run_at: lastRun,
    last_status: status,
    last_error: errMsg,
    next_run_at: next,
    disable: isOnce,
  });
  ctx.project.logMessage?.({
    channel: CHANNELS.ROUTINE,
    direction: "out",
    type: "system",
    actor_id: "apx:routine",
    author: "apx",
    body: status === "ok"
      ? `routine ${routine.name} ok${skip ? " (skipped LLM)" : ""}`
      : `routine ${routine.name} error: ${errMsg}`,
    meta: {
      routine: routine.name, status, skipped: skip, result,
      // Persisted run flow so the UI can replay pre → action → post.
      flow: {
        pre: hasPreCmds ? { output: preStdout.slice(0, 8000), exit: preExitCode } : null,
        post: postRuns.length ? postRuns : null,
      },
    },
  });
  return { ...result, last_run_at: lastRun, next_run_at: next };
}
