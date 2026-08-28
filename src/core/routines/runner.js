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
import { TELEGRAM_TOOL_ITERS, ROUTINE_UNCAPPED_TOOL_ITERS } from "#core/agent/constants.js";
import { createToolSession, makeToolHandlers } from "#core/agent/tools/registry.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { resolveAgentAllowedTools } from "#core/agent/agent-tools.js";
import { resolveAgentName, SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { recordAgentTurn } from "#core/stores/turn-record.js";
import { resolveArtifactRef, ARTIFACTS_SKIP_SIGNAL } from "#core/stores/artifacts.js";
import {
  ensureRoutineMemory,
  readRoutineMemoryForPrompt,
  routineMemoryPath,
} from "#core/stores/routine-memory.js";
import { buildRoutineHeader, prependRoutineHeader } from "#core/routines/header.js";
import {
  startRoutineRun,
  setRoutineRunPhase,
  startRoutineRunTool,
  finishRoutineRunTool,
  addRoutineRunText,
  setRoutineRunConversation,
  endRoutineRun,
} from "#core/routines/active-runs.js";
import {
  resolveDeliveryChannels,
  deliverySuppressedTools,
  deliverRoutineOutput,
  alreadyServedChannels,
  routineOutputText,
  notifyOwnerViaRoby,
  readAbstention,
  abstentionChannels,
  ABSTAIN_MARKER,
  AGENT_WEB_CHAT_ID,
} from "#core/routines/delivery.js";
import { recordDelivery, markDelivery, DELIVERY_STATUS } from "#core/stores/deliveries.js";
import { CHANNELS } from "#core/constants/channels.js";
import { detectSignals, formatSignals, peakSeverity, thresholdsFromConfig } from "#core/routines/signals.js";
import { readActiveProfile, effectiveProfileConfig } from "#core/profiles/store.js";
import {
  updateRunState,
  parseSchedule,
  computeNextRun,
} from "#core/stores/routines.js";
import { nowIso } from "#core/util/time.js";
import { loadAgentSkills, collectAgentSkillMedia } from "#core/agent/skills/agent-skills.js";

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
  // `text` is the run's output (routineOutputText): a heartbeat's product IS
  // this line, and without naming it here a heartbeat with a delivery channel
  // had something to say and delivered an empty string.
  return { status: "ok", text: message, note: `logged to messages on channel '${channel}'` };
}

// Is this routine "telegram-bound" — i.e. is its PRODUCT a Telegram message? The
// reliable signal is a `apx telegram …` post_command, which pipes the model's
// final text straight into Telegram and shows up here as a suppressed
// send_telegram (see tools-overlap.js). There the final turn literally becomes
// the message, so the bounded single-turn chat budget is the right shape.
//
// Merely HAVING the send_telegram tool available does NOT count: it's a
// near-universal default (an empty allowed_tools falls back to the broad set),
// so keying on it would mark almost every routine telegram-bound and cap the
// exact background work this distinction exists to free. Magui filling a backlog
// might send a summary at the end, but her job is the backlog, not the message —
// she must finish first. So only the post_command sink marks telegram-bound.
export function routineReportsToTelegram({ autoSuppress, deliverTo }) {
  // `deliver_to: ["telegram"]` is the same shape of sink, declared on the
  // routine instead of in a shell string: the runner hands the final text to
  // Telegram, so the final turn IS the message here too. No routine that
  // predates deliver_to has one, so this widens the rule without moving any
  // existing routine from one budget to the other.
  if ((deliverTo || []).includes(CHANNELS.TELEGRAM)) return true;
  return (autoSuppress || []).includes("send_telegram");
}

// Tool-loop budget for a routine: the bounded conversational budget when it
// reports to Telegram, an effectively-unbounded ceiling when it doesn't (see
// ROUTINE_UNCAPPED_TOOL_ITERS). Both honor a per-deployment config override.
export function routineToolIters(config, { telegramBound }) {
  const sa = config?.super_agent || {};
  const pick = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return telegramBound
    ? pick(sa.telegram_max_iters, TELEGRAM_TOOL_ITERS)
    : pick(sa.routine_max_iters, ROUTINE_UNCAPPED_TOOL_ITERS);
}

/**
 * Bridge the agent loop's progress events onto the open run record, so a panel
 * can watch a run TAKE its steps. Until this existed the only trace of a run
 * was written at the end, which meant a four-minute routine was four minutes of
 * nothing followed by a wall of text.
 *
 * Returns null when no run is open (a direct handler call in a test), and the
 * loop then pays one `if` per event instead of building a record nobody reads.
 */
function runProgressEvents(runId) {
  if (!runId) return null;
  return (ev) => {
    if (ev?.type === "tool_start") {
      startRoutineRunTool(runId, { traceId: ev.trace?.id, tool: ev.trace?.tool, args: ev.trace?.args });
    } else if (ev?.type === "tool_result") {
      finishRoutineRunTool(runId, { traceId: ev.trace?.id, tool: ev.trace?.tool, result: ev.trace?.result });
    } else if (ev?.type === "assistant_text") {
      addRoutineRunText(runId, ev.text);
    }
  };
}

async function handleExecAgent(ctx, routine) {
  const { project, globalConfig, projects, plugins, registries } = ctx;
  const { agent: slug, prompt } = routine.spec;
  if (!slug || !prompt) throw new Error("exec_agent: spec needs { agent, prompt }");

  const agents = readAgents(project.path);
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) throw new Error(`agent ${slug} not found`);
  const agentName = agent.fields?.Name || agent.name || slug;
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
  // A non-Roby agent that delivers to web gets its OWN persistent web chat
  // (web-main), written by the delivery adapter. Recording a fresh per-run
  // routine conversation here too would give it a second, noisier thread — so
  // for that case keep only the ledger audit and let the web chat be the thread.
  const isProjectAgent = slug !== SUPERAGENT_ACTOR_ID;
  const deliversToWeb = (ctx.deliverTo || []).includes(CHANNELS.WEB);
  const ledgerOnly = isProjectAgent && deliversToWeb;

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

  // Images the agent's skills declare: the pool attach_media / view_media
  // validate against, and the sink a queued attachment lands in for delivery.
  // Same skills the system prompt above rendered, so the manifest the model
  // sees and the ids it can attach never drift.
  const attachableMedia = collectAgentSkillMedia(loadAgentSkills(project, agent));
  const mediaSink = [];

  let text = "";
  let trace = [];
  let usage = null;
  let allowedTools = [];
  // What ANSWERED, which is not always what was resolved: the router can fall
  // back mid-run, and the record should name the model that produced the reply.
  let answeredOn = model;

  if (noTools) {
    const result = await callEngine({
      modelId: model,
      system,
      messages: [{ role: "user", content: prompt }],
      config,
    });
    text = result.text || "";
    usage = result.usage;
    answeredOn = result.model || model;
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
    // A configured delivery owns the message the same way a post_command sink
    // does — leaving send_telegram in the loop next to `deliver_to: telegram`
    // is the two-messages bug of spec/done/01 with a different sink.
    const deliverSuppress = deliverySuppressedTools(ctx.deliverTo);
    const suppressTools = [...new Set([...autoSuppress, ...explicitSuppress, ...deliverSuppress])];
    allowedTools = resolveAgentAllowedTools(agent, { override: toolOverride });
    const toolSession = createToolSession(CHANNELS.ROUTINE, { allowedTools });
    // A routine that reports to Telegram keeps the bounded chat budget; one that
    // does background work nobody watches runs to completion (Magui's backlog
    // refill was being cut off at ~23 steps by the Telegram budget).
    const telegramBound = routineReportsToTelegram({ autoSuppress, deliverTo: ctx.deliverTo });
    const maxIters = routineToolIters(cfg, { telegramBound });

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
        // Skill media plumbing for attach_media / view_media (see above).
        attachableMedia,
        mediaSink,
        requestConfirmation: null,
      },
      agentName: slug,
      onEvent: runProgressEvents(ctx.runId),
      suppressTools: suppressTools.length > 0 ? suppressTools : null,
      maxIters,
      // A routine has to both act and report, and 2048 was tight enough that a
      // run which wrote its output before filing it hit the cap mid-item. The
      // loop now recovers from that (see wasTruncated), but the headroom keeps
      // it from being the normal case.
      maxTokens: 4096,
    });
    text = result.text || "";
    trace = Array.isArray(result.trace) ? result.trace : [];
    usage = result.usage;
    answeredOn = result.model || model;

    const blocked = blockedForPermission(trace);
    if (blocked.length) {
      const { conversationId } = recordRoutineTurn(project, routine, {
        slug, model: answeredOn, prompt, reply: text, trace, usage, conversation: !ledgerOnly,
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
        agent_name: agentName,
        model: answeredOn,
        conversation_id: conversationId || (ledgerOnly ? AGENT_WEB_CHAT_ID : null),
        allowed_tools: allowedTools,
      };
    }
  }

  const { conversationId } = recordRoutineTurn(project, routine, {
    slug, model: answeredOn, prompt, reply: text, trace, usage, conversation: !ledgerOnly,
  });
  setRoutineRunConversation(ctx.runId, { conversationId, agentSlug: slug });
  return {
    status: "ok",
    reply: text,
    trace,
    agent_slug: slug,
    agent_name: agentName,
    model: answeredOn,
    conversation_id: conversationId || (ledgerOnly ? AGENT_WEB_CHAT_ID : null),
    allowed_tools: allowedTools,
    usage,
    // Images the agent queued with attach_media, for the delivery adapters.
    ...(mediaSink.length ? { attachments: mediaSink } : {}),
  };
}

/**
 * File this run the way a message to you is filed: one conversation to reopen,
 * one set of ledger rows to search — written by the SAME recorder every other
 * channel uses, so a run records which agent answered, on which model, and what
 * it cost. It used to have its own pair of writers here, and the file half of
 * that pair wrote text and nothing else: the thread opened as "0 tok", no
 * model, no actor. A scheduled run is the case where the stored record is the
 * only record there will ever be — nobody watched it stream.
 */
function recordRoutineTurn(project, routine, { slug, model, prompt, reply, trace, usage, conversation = true }) {
  return recordAgentTurn({
    project,
    agentSlug: slug,
    channel: CHANNELS.ROUTINE,
    title: routine.name,
    model,
    prompt,
    // False for a delivering project agent: its user-facing thread is its own
    // persistent web chat, not a per-run routine conversation. The ledger audit
    // (usage/model/trace) is still written either way.
    conversation,
    // The thread says whose clock woke it; the ledger row keeps the bare prompt
    // (it already carries `meta.routine`, and search should match the words the
    // routine actually asked).
    filedPrompt: `[routine: ${routine.name}]\n\n${prompt}`,
    reply,
    trace,
    usage,
    scope: { routine: routine.name },
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
  // Same rule as exec_agent: a channel the runner is going to deliver to loses
  // its in-loop twin, so the run produces one message and not two.
  const deliverSuppress = deliverySuppressedTools(ctx.deliverTo);
  const suppressTools = [...new Set([...autoSuppress, ...explicitSuppress, ...deliverSuppress])];

  // Same rule as exec_agent: only a `apx telegram …` post_command makes the run
  // telegram-bound (bounded chat budget). A super_agent report that sends via the
  // send_telegram tool — like the secretary open/close — is work that should run
  // to completion, which also lifts it off runSuperAgent's low chit-chat default
  // of MAX_TOOL_ITERS.
  const telegramBound = routineReportsToTelegram({ autoSuppress, deliverTo: ctx.deliverTo });
  const maxIters = routineToolIters(cfg, { telegramBound });

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
    maxIters,
    onEvent: runProgressEvents(ctx.runId),
  });

  // A tool that needed a human in a run with no human is a DEAD END, not a
  // hiccup: nobody is ever going to confirm it. Reporting the run as "ok"
  // meant the only symptom was silence — the evening anchor produced nothing
  // and it took twenty-one shell commands to work out why. Name it.
  const blocked = blockedForPermission(result.trace);

  // Same recorder as exec_agent and as a message typed by hand — the prompt, the
  // steps, and a reply stamped with model and usage. The super-agent's chats
  // live in the ledger rather than in per-agent conversation files, so only that
  // half is written; what goes into it is the same shape either way.
  recordAgentTurn({
    project,
    agentSlug: SUPERAGENT_ACTOR_ID,
    agentName: result.name || resolveAgentName(globalConfig),
    actorKind: "superagent",
    conversation: false,
    channel: CHANNELS.ROUTINE,
    model: result.model,
    prompt,
    reply: result.text || "",
    trace: result.trace,
    usage: result.usage,
    scope: { routine: routine.name },
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

/**
 * The active agent profile's settings, or `{}`. Read by the watcher (for its
 * thresholds) and by delivery (for `deliver_to: ["profile"]`), and swallowing
 * the error is the point: a profile that fails to load must not take down a
 * run that has nothing to do with it.
 */
function activeProfileConfig(globalConfig) {
  try {
    const active = readActiveProfile(globalConfig);
    return active ? (effectiveProfileConfig(active, globalConfig) || {}) : {};
  } catch {
    return {};
  }
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
  const profileConfig = activeProfileConfig(globalConfig);

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
    // So the a2a detector surfaces each message once — everything that arrived
    // since this watch last ran, and nothing it already considered.
    a2a_since: routine.last_run_at || routine.last_run || "",
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
        "so say the one thing that matters. Staying quiet is a valid outcome — reply with " +
        `${ABSTAIN_MARKER} on the first line when you choose it, and your reasoning after.`,
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
    // Solicited when the owner explicitly asked to be told about one of these
    // (an a2a message tagged solicited). It crosses the interruption budget the
    // same way a reply does — see the gate in core/routines/delivery.js.
    solicited: signals.some((s) => s.payload?.solicited === true),
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

// The one-line notification a delivery hands the mascot / push feed: short
// enough for a bubble, in the message's own language. Two tiers, so tokens are
// only spent when they buy something:
//   • a short message IS its own headline — take its first meaningful line, free;
//   • a long one gets a real ≤100-char summary from the model ("you have a golf
//     trivia to answer" rather than the first 100 chars of a wall of text).
const NOTIFY_MAX_CHARS = 100;
const NOTIFY_SUMMARY_OVER = 280;

function firstLineNotify(text) {
  const line = String(text || "")
    .split("\n").map((s) => s.trim()).find(Boolean) || "";
  // Strip the loudest markdown so the bubble reads as prose, keep emoji.
  return line.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, NOTIFY_MAX_CHARS);
}

export async function buildDeliveryNotify({ text, model, config }) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  if (clean.length <= NOTIFY_SUMMARY_OVER) return firstLineNotify(clean);
  // Long → a dedicated tiny summary. Kept model-authored (never a canned string)
  // and in the message's own language; a model that is down falls back to the
  // truncated headline rather than going silent.
  try {
    const r = await callEngine({
      modelId: model,
      system:
        "You write ONE ultra-short notification line (max 100 characters) that tells the user " +
        "what a message is about, so they know whether to open it. Write in the SAME language as " +
        "the message. No quotes, no preamble, no trailing period — just the line.",
      messages: [{ role: "user", content: `Message:\n\n${clean}\n\nNotification line (≤100 chars):` }],
      config,
    });
    const line = String(r.text || "").replace(/\s+/g, " ").trim().slice(0, NOTIFY_MAX_CHARS);
    return line || firstLineNotify(clean);
  } catch {
    return firstLineNotify(clean);
  }
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
  // The run record is opened HERE, around everything, so a routine is visible
  // as running from its first millisecond — including while a pre_command is
  // still shelling out, which is where the old panel showed nothing at all.
  const run = startRoutineRun({
    projectRoot: ctx.project?.storagePath || os.homedir(),
    routine,
    trigger: ctx.trigger || "manual",
  });
  let out = null;
  let failure = null;
  try {
    out = await runRoutinePipeline({ ...ctx, runId: run.id }, routine);
    return out;
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    endRoutineRun(run.id, {
      status: failure || out?.status === "error" ? "error" : "ok",
      error: failure?.message || out?.error || null,
      conversationId: out?.conversation_id || null,
      agentSlug: out?.agent_slug || null,
      text: out?.reply || out?.text || null,
    });
  }
}

async function runRoutinePipeline(ctx, routine) {
  const cwd = ctx.project?.path || os.homedir();
  const storagePath = ctx.project?.storagePath || os.homedir();

  const hasPreCmds  = Array.isArray(routine.pre_commands)  && routine.pre_commands.length  > 0;
  const hasPostCmds = Array.isArray(routine.post_commands) && routine.post_commands.length > 0;

  // Where this run's output goes, resolved ONCE and before the handler runs —
  // the handlers need it too, because a channel the runner is going to deliver
  // to has its in-loop twin (send_telegram) suppressed for the run.
  const delivery = resolveDeliveryChannels(routine, {
    profileConfig: activeProfileConfig(ctx.globalConfig),
    globalConfig: ctx.project?.config || ctx.globalConfig,
  });
  const runCtx = delivery.channels.length ? { ...ctx, deliverTo: delivery.channels } : ctx;

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
  setRoutineRunPhase(ctx.runId, "agent");

  let result = { status: "ok" };
  let status = "ok";
  let errMsg = null;

  if (!skip) {
    // The automation header: name / id / memory path / last run / this run,
    // built once so a single run stamps one instant. Prepended to the LLM
    // prompt so the model always opens on its identity and the current time
    // natively — the routine no longer needs an `echo …date…` pre_command
    // feeding {{pre_output}} just to know what day it is. It rides on
    // `spec.prompt` ONLY: a telegram routine's `spec.text` is the message body
    // sent verbatim to the chat (handleTelegram), so a header there would leak
    // into the delivered message, not brief a model.
    const header = buildRoutineHeader(routine, {
      storagePath,
      config: ctx.project?.config || ctx.globalConfig,
      nowMs: Date.now(),
    });

    // Injected unconditionally, including when there is no pre output at all.
    // A routine that asks for {{pre_output}} and gets nothing must see an empty
    // slot, not the literal braces: a placeholder that survives into the prompt
    // reaches the model as text and it will dutifully try to make sense of it.
    // The replace is a no-op for the routines that never mention it.
    const enrichedRoutine = {
      ...routine,
      spec: {
        ...routine.spec,
        // {{pre_output}} works in both the LLM prompt and the telegram text;
        // the header rides on the prompt only (see above). Keys the spec does
        // not have stay absent — a `prompt: undefined` on a shell routine would
        // be a new shape for every reader downstream.
        ...(typeof routine.spec?.prompt === "string" ? { prompt: prependRoutineHeader(injectPreOutput(routine.spec.prompt, preStdout), header) } : {}),
        ...(typeof routine.spec?.text === "string" ? { text: injectPreOutput(routine.spec.text, preStdout) } : {}),
      },
    };

    const handler = HANDLERS[enrichedRoutine.kind];
    if (!handler) {
      status = "error";
      errMsg = `unknown routine kind: ${enrichedRoutine.kind}`;
    } else {
      try {
        result = await handler(runCtx, enrichedRoutine);
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

  // ── Phase 2.5: delivery ───────────────────────────────────────────────────
  // The run's own answer, handed to every channel the routine is configured
  // for. Before this phase existed the answer went to the ledger and stopped
  // there: reaching a person meant a shell post_command or a paragraph in the
  // prompt asking the model to call send_telegram, and the failure mode of both
  // is silence. See core/routines/delivery.js.
  setRoutineRunPhase(ctx.runId, "delivery");
  const llmOutput = result?.reply || result?.text || "";
  const deliveryText = routineOutputText(result);
  // A run that judged it had nothing worth interrupting for. Not an empty run
  // and not a failed one — a decision, and the watch prompts have always told
  // the model that making it is free. Until this branch existed it was not:
  // "Me mantengo en silencio…" was delivered as the news and charged to the
  // interruption budget like any other push. See readAbstention in delivery.js.
  const abstention = readAbstention(deliveryText);
  const wanted = delivery.channels.length + delivery.unknown.length;
  let deliveries = [];
  let deliverySkipped = [];
  if (wanted > 0 && status === "ok" && abstention) {
    result = { ...result, abstained: true, abstain_reason: abstention.reason || null };
    // No gate, so no nudge is spent and no cooldown consumed; no push channel,
    // so nothing reaches the phone. A bare marker with no reasoning is written
    // nowhere at all — the run log already records that it ran and stayed quiet.
    if (abstention.reason) {
      deliveries = await deliverRoutineOutput(runCtx, {
        routine,
        channels: abstentionChannels(delivery.channels),
        text: abstention.reason,
        gate: null,
        abstained: true,
        agent:
          result?.agent_slug && result.agent_slug !== SUPERAGENT_ACTOR_ID
            ? { slug: result.agent_slug, name: result.agent_name || result.agent_slug, model: result.model, usage: result.usage }
            : { slug: SUPERAGENT_ACTOR_ID, model: result?.model, usage: result?.usage },
      });
    }
  } else if (wanted > 0 && status === "ok" && deliveryText) {
    deliverySkipped = alreadyServedChannels({
      routine,
      channels: delivery.channels,
      postSinks: computeSuppressedTools(routine.post_commands),
      trace: result?.trace,
    });
    const skipIds = new Set(deliverySkipped.map((d) => d.channel));
    // The interruption budget, applied to the push channels delivery owns now
    // that send_telegram is suppressed for a delivering routine. An anchor is
    // `scheduled` and exempt; a watch/a2a run carries its detector's peak
    // severity (a blocker is critical and crosses quiet-hours); a run the owner
    // solicited crosses the budget like a reply. See core/routines/delivery.js.
    const gate = {
      severity: result?.peak_severity || "normal",
      scheduled: routine.spec?.anchor === true,
      unsolicited: !(result?.solicited === true),
      project_id: ctx.project?.id ?? null,
    };
    const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
    const channels = delivery.channels.filter((c) => !skipIds.has(c));

    // Manu's rule: a routine run by an agent that is NOT Roby must post to its
    // OWN web chat and, instead of pinging the phone itself, leave a delivery
    // for Roby to notify. So for a project agent we split the configured
    // channels — the chat channels go to the agent's own thread, and any push
    // channel (telegram) becomes an a2a emit to Roby, who decides the notify.
    const runByAgent =
      result?.agent_slug && result.agent_slug !== SUPERAGENT_ACTOR_ID
        ? { slug: result.agent_slug, name: result.agent_name || result.agent_slug, model: result.model, usage: result.usage }
        : null;

    if (runByAgent) {
      // The short notification line the mascot / push feed shows (see
      // buildDeliveryNotify): a headline for a short tip, a model summary for a
      // long one. Rides on the delivery so the web ledger row carries it and the
      // event feed can hand it to the pet.
      runByAgent.notify = await buildDeliveryNotify({
        text: deliveryText,
        model: runByAgent.model,
        config: ctx.project?.config || ctx.globalConfig,
      });
      const pushChannels = channels.filter((c) => c === CHANNELS.TELEGRAM);
      const chatChannels = channels.filter((c) => c !== CHANNELS.TELEGRAM);
      deliveries = await deliverRoutineOutput(runCtx, {
        routine, channels: chatChannels, text: deliveryText, gate, attachments, agent: runByAgent,
      });

      // The delivery queue — one record per thing left waiting for Manu, visible
      // as it piles up and gets crossed off (see core/stores/deliveries.js).
      const priority = routine.spec?.anchor === true;
      const delId = recordDelivery(storagePath, {
        agent: runByAgent.slug,
        agentName: runByAgent.name,
        routine: routine.name,
        routineId: routine.id || "",
        notify: runByAgent.notify,
        priority,
        project_id: ctx.project?.id ?? null,
      });

      // How Roby tells Manu, by priority:
      //   • an anchor (urgent) delivery notifies NOW, crossing the budget;
      //   • an ordinary one is LEFT PENDING — the daemon's grace sweep notifies it
      //     ~a minute later, unless Manu opens the chat and replies first, which
      //     marks it answered and cancels the notify (answerDeliveries).
      if (pushChannels.length) {
        if (priority) {
          const r = await notifyOwnerViaRoby(runCtx, {
            routine, agent: runByAgent, text: deliveryText, notify: runByAgent.notify, gate,
          });
          if (r.sent) {
            markDelivery(storagePath, delId, DELIVERY_STATUS.NOTIFIED, { channel: "telegram" });
            deliveries.push({ channel: "telegram(roby)", status: "ok", note: r.reason || "roby notified" });
          } else if (r.held) {
            markDelivery(storagePath, delId, DELIVERY_STATUS.HELD, { reason: r.reason });
            deliveries.push({ channel: "telegram(roby)", status: "held", reason: r.reason });
          } else {
            deliveries.push({ channel: "telegram(roby)", status: "error", error: r.reason || "not sent" });
          }
        } else {
          deliveries.push({ channel: "telegram(roby)", status: "deferred", note: "grace window — Roby notifies unless answered first" });
        }
      }
    } else {
      // The super-agent's own routine. Carry its model/usage so the delivered
      // web-thread row is attributed like every other agent turn (the ledger
      // adapter reads agent.model/agent.usage), not filed as "0 tok"/no model.
      deliveries = await deliverRoutineOutput(runCtx, {
        routine, channels, text: deliveryText, gate, attachments,
        agent: { slug: SUPERAGENT_ACTOR_ID, model: result?.model, usage: result?.usage },
      });
    }
    for (const id of delivery.unknown) {
      deliveries.push({ channel: id, status: "error", error: `unknown delivery channel: ${id}` });
    }
    // Asked to deliver, delivered nowhere, and nothing else was going to carry
    // it — that is the exact shape of failure this feature exists to end, so it
    // is reported as an error rather than as a run that "went fine". A `held`
    // delivery is NOT that failure: the budget withheld it on purpose, and the
    // message survives in the run log to fold into the next brief.
    const anyOk =
      deliveries.some((d) => d.status === "ok" || d.status === "held" || d.status === "deferred") ||
      deliverySkipped.length > 0;
    if (!anyOk) {
      status = "error";
      errMsg =
        `nothing delivered: ${deliveries.map((d) => `${d.channel} (${d.error})`).join("; ")}. ` +
        `The run produced an answer and no one received it.`;
    }
  }

  // ── Phase 3: post_commands ────────────────────────────────────────────────
  const postRuns = [];
  if (hasPostCmds) {
    setRoutineRunPhase(ctx.runId, "post");
    const postEnv = {
      ...pipelineEnv,
      APX_LLM_OUTPUT: llmOutput.slice(0, 32_000),
      APX_STATUS: status,
      APX_SKIPPED: skip ? "1" : "0",
      APX_DELIVERED: deliveries.filter((d) => d.status === "ok").map((d) => d.channel).join(","),
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
      ? `routine ${routine.name} ok${skip ? " (skipped LLM)" : result?.abstained ? " (stayed quiet)" : ""}`
      : `routine ${routine.name} error: ${errMsg}`,
    meta: {
      routine: routine.name, status, skipped: skip, result,
      // Persisted run flow so the UI can replay pre → action → delivery → post.
      flow: {
        pre: hasPreCmds ? { output: preStdout.slice(0, 8000), exit: preExitCode } : null,
        delivery: wanted ? { channels: delivery.channels, source: delivery.source, results: deliveries, skipped: deliverySkipped } : null,
        post: postRuns.length ? postRuns : null,
      },
    },
  });
  return {
    ...result,
    // A caller that ran the routine by hand (CLI, API, the web panel) should be
    // able to see where the answer went without going to read the ledger.
    ...(wanted
      ? { delivery: { channels: delivery.channels, source: delivery.source, results: deliveries, skipped: deliverySkipped } }
      : {}),
    ...(status === "error" && result?.status !== "error" ? { status, error: errMsg } : {}),
    last_run_at: lastRun,
    next_run_at: next,
  };
}
