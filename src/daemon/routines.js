// Routines: scheduled tasks per project. State persists in .apc/routines.json.
//
// Schedule formats:
//   every:60s | every:5m | every:1h | once:<iso-8601>
//
// Kinds:
//   heartbeat   — log a heartbeat message.   spec: { channel?, message? }
//   exec_agent  — call an agent engine.       spec: { agent: slug, prompt }
//   super_agent — call the APX super-agent.   spec: { prompt }
//   telegram    — send a Telegram message.    spec: { channel?, chat_id?, text }
//   shell       — run a shell command.        spec: { command, timeout_ms? }

import { spawn } from "node:child_process";
import { callEngine } from "./engines/index.js";
import { runSuperAgent } from "./super-agent.js";
import { readAgents } from "../core/parser.js";
import { buildAgentSystem } from "../core/agent-system.js";
import {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled,
  updateRunState,
  getDueRoutines,
  parseSchedule,
  computeNextRun,
} from "../core/routines-store.js";

export {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled,
  parseSchedule,
  computeNextRun,
};

const TICK_MS = 5_000;
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
    channel: "routine",
    direction: "out",
    type: "agent",
    actor_id: slug,
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

  const result = await runSuperAgent({
    globalConfig: cfg,
    projects,
    plugins,
    registries,
    prompt,
    contextNote: `You were invoked by APX routine "${routine.name}" in project ${project.path}. This is an autonomous scheduled run, not an interactive Telegram reply.`,
  });

  project.logMessage({
    channel: "routine",
    direction: "out",
    type: "agent",
    actor_id: result.name || "super_agent",
    author: result.name || "super_agent",
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

// --------------------- runtime: run one + loop ------------------------------

export async function runRoutineNow(ctx, routine) {
  const handler = HANDLERS[routine.kind];
  if (!handler) throw new Error(`unknown routine kind: ${routine.kind}`);
  let result;
  let status = "ok";
  let errMsg = null;
  try {
    result = await handler(ctx, routine);
    if (result?.status === "error") {
      status = "error";
      errMsg = result.error || result.stderr || `routine ${routine.name} returned error status`;
    }
  } catch (e) {
    status = "error";
    errMsg = e.message;
    result = { status: "error", error: e.message };
  }
  const lastRun = nowIso();
  const next = computeNextRun({ schedule: routine.schedule, last_run_at: lastRun });
  const isOnce = parseSchedule(routine.schedule).kind === "once";
  updateRunState(ctx.project.path, routine.name, {
    last_run_at: lastRun,
    last_status: status,
    last_error: errMsg,
    next_run_at: next,
    disable: isOnce,
  });
  ctx.project.logMessage?.({
    channel: "routine",
    direction: "out",
    type: "system",
    actor_id: "apx:routine",
    author: "apx",
    body: status === "ok"
      ? `routine ${routine.name} ok`
      : `routine ${routine.name} error: ${errMsg}`,
    meta: { routine: routine.name, status, result },
  });
  return { ...result, last_run_at: lastRun, next_run_at: next };
}

export class RoutineScheduler {
  constructor({ projects, plugins, registries, globalConfig, log }) {
    this.projects = projects;
    this.plugins = plugins;
    this.registries = registries;
    this.globalConfig = globalConfig;
    this.log = log || (() => {});
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(
      () => this._tick().catch((e) => this.log(`routines tick error: ${e.message}`)),
      TICK_MS
    );
    this._timer.unref?.();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    if (this._running) return;
    this._running = true;
    try {
      const nowStr = nowIso();
      for (const proj of this.projects.list().map((p) => this.projects.get(p.id))) {
        if (!proj) continue;
        const due = getDueRoutines(proj.path, nowStr);
        for (const r of due) {
          this.log(`routine ${r.name} (${r.kind}) firing in project #${proj.id}`);
          await runRoutineNow(
            {
              project: proj,
              projects: this.projects,
              plugins: this.plugins,
              registries: this.registries,
              globalConfig: this.globalConfig,
            },
            r
          );
        }
      }
    } finally {
      this._running = false;
    }
  }
}
