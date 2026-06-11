// Routine execution — the domain logic any caller can invoke (daemon
// scheduler, CLI `apx routine run`, HTTP `/projects/:pid/routines/:name/run`,
// MCP server, future scripts). The runner orchestrates a 3-phase pipeline:
//   1. pre_commands  (shell)
//   2. handler       (heartbeat / exec_agent / super_agent / telegram / shell)
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
import { computeSuppressedTools } from "#core/agent/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { resolveArtifactRef, ARTIFACTS_SKIP_SIGNAL } from "#core/stores/artifacts.js";
import {
  ensureRoutineMemory,
  readRoutineMemoryForPrompt,
  routineMemoryPath,
} from "#core/stores/routine-memory.js";
import { CHANNELS } from "#core/constants/channels.js";
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
  const { project, globalConfig } = ctx;
  const { agent: slug, prompt } = routine.spec;
  if (!slug || !prompt) throw new Error("exec_agent: spec needs { agent, prompt }");

  const agents = readAgents(project.path);
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) throw new Error(`agent ${slug} not found`);
  const model = agent.fields.Model;
  if (!model) throw new Error(`agent ${slug} has no model`);

  const result = await callEngine({
    modelId: model,
    system: buildAgentSystem(project, agent, {
      invocation: "routine",
      routine: routine.name,
      extraParts: [`Reply briefly, max 4 sentences.`],
    }),
    messages: [{ role: "user", content: prompt }],
    config: project.config || globalConfig,
  });

  project.logMessage({
    agent_slug: slug,
    channel: CHANNELS.ROUTINE,
    direction: "out",
    type: "agent",
    actor_id: slug,
    actor_kind: "agent",
    author: slug,
    body: result.text,
    meta: { routine: routine.name, usage: result.usage },
  });
  return { status: "ok", reply: result.text };
}

async function handleSuperAgent(ctx, routine) {
  const { project, globalConfig, projects, plugins, registries } = ctx;
  const { prompt } = routine.spec;
  if (!prompt) throw new Error("super_agent: spec needs { prompt }");

  const cfg = structuredClone(globalConfig || {});
  cfg.super_agent = {
    ...(globalConfig?.super_agent || {}),
    ...(routine.permission_mode ? { permission_mode: routine.permission_mode } : {}),
    ...(Array.isArray(routine.allowed_tools) ? { allowed_tools: routine.allowed_tools } : {}),
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
    },
    suppressTools: suppressTools.length > 0 ? suppressTools : null,
  });

  project.logMessage({
    channel: CHANNELS.ROUTINE,
    direction: "out",
    type: "agent",
    actor_id: SUPERAGENT_ACTOR_ID,
    actor_kind: "superagent",
    author: result.name || resolveAgentName(globalConfig),
    body: result.text || "",
    meta: { routine: routine.name, tool_trace: result.trace, usage: result.usage },
  });
  return { status: "ok", reply: result.text, trace: result.trace };
}

async function handleTelegram(ctx, routine) {
  const { plugins } = ctx;
  const tg = plugins?.get("telegram");
  if (!tg) throw new Error("telegram plugin not loaded");
  const { channel, chat_id, text } = routine.spec;
  if (!text) throw new Error("telegram routine needs spec.text");
  await tg.send({ channel, chat_id, text });
  return { status: "ok" };
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

const HANDLERS = {
  heartbeat: handleHeartbeat,
  exec_agent: handleExecAgent,
  super_agent: handleSuperAgent,
  telegram: handleTelegram,
  shell: handleShell,
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
    const enrichedRoutine = (hasPreCmds && preStdout)
      ? {
          ...routine,
          spec: {
            ...routine.spec,
            prompt: injectPreOutput(routine.spec?.prompt, preStdout),
          },
        }
      : routine;

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
      await runShellCmd(cmd, postEnv, cwd);
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
    meta: { routine: routine.name, status, skipped: skip, result },
  });
  return { ...result, last_run_at: lastRun, next_run_at: next };
}
