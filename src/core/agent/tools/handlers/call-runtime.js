import fs from "node:fs";
import path from "node:path";
import { loggerFor } from "#core/logging.js";
import { readAgents } from "#core/apc/parser.js";
import { apcProjectFile } from "#core/apc/paths.js";
import {
  closeRuntimeSession,
  createRuntimeSession,
  extractRuntimeResult as extractApfResult,
} from "#core/stores/runtime-sessions.js";
import { writePendingCallback, deletePendingCallback } from "#core/stores/runtime-callbacks.js";
import { buildRuntimeBridgeHint as buildApfHint } from "#core/agent/runtime-bridge.js";
import { detectAll } from "#core/runtimes/detect.js";
import {
  findEngineSessionById,
  readEngineSessionContext,
} from "#core/stores/engine-sessions.js";
import { runProcess } from "#host/daemon/runtimes/_spawn.js";
import { getRuntime, RUNTIME_IDS } from "#host/daemon/runtimes/index.js";
import { buildAgentSystem, resolveProject } from "../helpers.js";

const log = loggerFor("call_runtime");

// Decide if the runtime actually did the work the model asked for. A spawn
// failure (-1), a non-zero exit, or a clean exit with no captured output and
// no transcript path all point at "process didn't really run" — exactly the
// false-positive scenario this guard exists to catch.
function runtimeLooksLikeFailure(r) {
  if (!r) return { failed: true, reason: "no runtime result" };
  if (r.exitCode === -1 || r.error) {
    return { failed: true, reason: r.error || "spawn error" };
  }
  if (typeof r.exitCode === "number" && r.exitCode !== 0) {
    return { failed: true, reason: `exit ${r.exitCode}` };
  }
  if (r.killed) return { failed: true, reason: "killed (timeout)" };
  const out = String(r.output || "").trim();
  const stderr = String(r.stderr || "").trim();
  if (!out && !r.externalSessionPath && !r.sessionId) {
    return {
      failed: true,
      reason: stderr ? `empty output (stderr: ${stderr.slice(0, 120)})` : "empty output",
    };
  }
  return { failed: false };
}

// If the model passed resume_session_id, look the session up (claude / codex /
// apx) and prepend a tiny context block so the runtime knows what the prior
// session was about. The model's prompt still wins; this is preamble only.
function buildResumePreamble(sessionId) {
  if (!sessionId) return { text: "", meta: null };
  let meta;
  try {
    meta = findEngineSessionById(sessionId);
  } catch {
    return { text: "", meta: null };
  }
  if (!meta) return { text: "", meta: null };
  const ctx = readEngineSessionContext(meta);
  const title = ctx?.title || meta.title || null;
  const lastPrompt = ctx?.lastPrompt || null;
  if (!title && !lastPrompt) return { text: "", meta };
  const parts = [
    `## Context from prior session (${meta.engine}:${meta.id})`,
  ];
  if (title) parts.push(`Title: ${title}`);
  if (lastPrompt) parts.push(`Last prompt: ${lastPrompt}`);
  parts.push("---");
  return { text: parts.join("\n") + "\n\n", meta };
}

function resolveProjectForAgent(projects, project, slug) {
  if (project) return resolveProject(projects, project);

  const defaultProject = projects.get(0);
  if (defaultProject && readAgents(defaultProject.path).find((a) => a.slug === slug)) {
    return defaultProject;
  }

  const matches = [];
  for (const entry of projects.list()) {
    const p = projects.get(entry.id);
    if (readAgents(p.path).find((a) => a.slug === slug)) matches.push(p);
  }
  if (matches.length === 1) return matches[0];
  if (defaultProject) return defaultProject;
  return resolveProject(projects, project);
}

function projectName(project) {
  try {
    const meta = JSON.parse(fs.readFileSync(apcProjectFile(project.path), "utf8"));
    if (meta.name) return meta.name;
  } catch {}
  return path.basename(project.path);
}

function buildRuntimeSystem(project, agent, runtime, sessionId, caller) {
  const agentSlug = agent?.slug || "apx";
  const hint = buildApfHint({
    projectName: projectName(project),
    projectPath: project.path,
    agentSlug,
    sessionId,
  });
  if (agent) {
    return buildAgentSystem(project, agent, {
      invocation: "runtime",
      runtime,
      caller,
      extraParts: [hint],
    });
  }

  return [
    "You are APX running inside an external coding runtime.",
    "No APC agent was explicitly selected for this run.",
    "Use the project context and runtime tools directly. Do not impersonate a project agent.",
    hint,
  ].join("\n\n");
}

async function runtimeAvailability(runtime, rt) {
  const probe = await runProcess({
    command: rt.binary,
    args: rt.versionFlag ? [rt.versionFlag] : ["--version"],
    timeoutMs: 3000,
  });
  if (probe.exitCode === 0 || probe.stdout || probe.stderr) {
    return { ok: true };
  }

  const detected = await detectAll();
  const current = detected.find((d) => d.id === runtime || d.binary === rt.binary);
  if (current?.installed) {
    return { ok: true, detected };
  }
  return {
    ok: false,
    reason: current?.reason || `${rt.binary} not found`,
    detected,
    installed: detected
      .filter((d) => d.category === "runtime" && d.installed)
      .map((d) => d.id),
  };
}

export default {
  name: "call_runtime",
  schema: {
    type: "function",
    function: {
      name: "call_runtime",
      description: "Spawn an external CLI runtime (Claude Code, Codex, OpenCode, Aider, Cursor Agent, Gemini CLI, Qwen Code). Omit agent for the base APX/default self-run.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "APC agent slug. MANDATORY OMIT if you are acting as yourself (APX/vos mismo/default). Use ONLY if the user named a specific agent from AGENTS.md." },
          runtime: {
            type: "string",
            enum: RUNTIME_IDS,
            description: "external CLI runtime",
          },
          prompt: { type: "string" },
          resume_session_id: {
            type: "string",
            description: "Optional prior session id (claude/codex/apx) — APX prepends that session's title + last prompt to the prompt so the runtime has context.",
          },
          timeout_s: { type: "integer", description: "seconds before SIGTERM. Foreground default 300; background runs default to 3600 (1h)." },
          background: {
            type: "boolean",
            description: "Run detached instead of blocking this turn. On Telegram this is the DEFAULT (runtimes like claude-code can take many minutes to an hour; blocking would freeze the super-agent). Returns immediately with status:\"launched\"; when the runtime finishes, its result is delivered to this same chat as an automatic message. Set false ONLY when you genuinely need the runtime's output within THIS turn for an immediate follow-up (short tasks).",
          },
        },
        required: ["runtime", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission, plugins, channel, channelMeta, backgroundResultSink = null }) => async ({ project, agent: slug, runtime, prompt, resume_session_id = null, timeout_s = null, background = null, confirmed = false }) => {
    await requirePermission("call_runtime", { dangerous: true, confirmed, args: { runtime } });

    // Async delivery sink: on Telegram we can push the runtime's result back to
    // the originating chat when it finishes, so the call doesn't have to block
    // the turn. channelMeta.chatId + the telegram plugin are what make that
    // possible; without them there's nowhere to deliver a late result, so we
    // stay synchronous (web/desktop/exec keep their current behavior).
    const chatId = channelMeta?.chatId ?? null;
    const tgChannelName = channelMeta?.channelName ?? null;
    const telegramPlugin = channel === "telegram" && chatId != null ? plugins?.get?.("telegram") : null;
    // We can report a late result either by re-entering the super-agent (A2A,
    // preferred — the agent relays in its own voice) or by a direct channel
    // send (fallback). Either makes background mode viable.
    const canCallback = !!backgroundResultSink || !!telegramPlugin;
    // Background by default when we can call back; the model opts out with
    // background:false when it needs the output inside this same turn.
    const runInBackground = canCallback && background !== false;
    // Long runtimes (claude-code sessions) can run for an hour; a detached run
    // must not be SIGTERM'd at the 5-min foreground default.
    const effectiveTimeoutS = Number(timeout_s) || (runInBackground ? 3600 : 300);

    const p = slug ? resolveProjectForAgent(projects, project, slug) : resolveProject(projects, project);
    const agent = slug ? readAgents(p.path).find((a) => a.slug === slug) : null;
    if (slug && !agent) {
      const directory = projects.list().map((entry) => ({
        project: entry.name,
        kind: entry.id === 0 ? "default" : "project",
        path: entry.path,
        agents: readAgents(projects.get(entry.id).path).map((a) => a.slug),
      }));
      return { error: `agent "${slug}" not found in selected project`, directory };
    }

    let rt;
    try {
      rt = getRuntime(runtime);
    } catch (e) {
      return { error: `${e.message}. Available runtimes: ${RUNTIME_IDS.join(", ")}` };
    }

    const availability = await runtimeAvailability(runtime, rt);
    if (!availability.ok) {
      return {
        error: `runtime "${runtime}" is not installed or not runnable (${availability.reason})`,
        runtime,
        binary: rt.binary,
        installed_runtimes: availability.installed,
        hint: availability.installed.length
          ? `Try one of: ${availability.installed.join(", ")}`
          : "No external runtime CLIs were detected. Run apx env detect for details.",
      };
    }

    const actor = agent?.slug || "apx";
    const session = createRuntimeSession({
      projectRoot: p.path,
      storageRoot: p.storagePath,
      agentSlug: actor,
      runtime,
      title: `Runtime: ${runtime}${agent ? ` (${agent.slug})` : ""}`,
    });

    const resume = buildResumePreamble(resume_session_id);
    const effectivePrompt = resume.text ? resume.text + prompt : prompt;

    log.info(`spawn ${runtime}`, {
      apc_session: session.id,
      agent: actor,
      project: p.path,
      resume_session_id: resume_session_id || null,
      resume_resolved: resume.meta ? `${resume.meta.engine}:${resume.meta.id}` : null,
      timeout_s: effectiveTimeoutS,
      background: runInBackground,
    });

    // Run the runtime to completion and finalize (close the session record, log
    // the transcript, shape the result object). NEVER throws — a thrown spawn is
    // caught and returned as an error object, so the background path can deliver
    // it as a callback instead of crashing an un-awaited promise.
    const runToCompletion = async () => {
      try {
        const r = await rt.run({
          system: buildRuntimeSystem(p, agent, runtime, session.id, "super_agent_tool"),
          prompt: effectivePrompt,
          cwd: p.path,
          timeoutMs: effectiveTimeoutS * 1000,
        });

        const failure = runtimeLooksLikeFailure(r);
        const result = extractApfResult(r.output) || (r.output || "").slice(0, 200);
        closeRuntimeSession({
          filePath: session.path,
          externalSessionPath: r.externalSessionPath || null,
          exitCode: failure.failed && r.exitCode === 0 ? -1 : r.exitCode,
          result: failure.failed ? `failed: ${failure.reason}` : result,
        });

        p.logMessage({
          agent_slug: actor,
          channel: "runtime",
          direction: "in",
          author: "user",
          body: effectivePrompt,
          meta: { runtime, invoked_by: "super_agent_tool", apc_session: session.id, resume_session_id: resume_session_id || null },
        });
        p.logMessage({
          agent_slug: actor,
          channel: "runtime",
          direction: "out",
          type: "agent",
          actor_id: agent?.slug || runtime,
          actor_kind: agent?.slug ? "agent" : "engine",
          author: agent?.slug || runtime,
          body: r.output || "",
          meta: {
            runtime,
            exit_code: r.exitCode,
            external_session_path: r.externalSessionPath || null,
            session_id: r.sessionId || null,
            apc_session: session.id,
            invoked_by: "super_agent_tool",
            failed: failure.failed || false,
            failure_reason: failure.failed ? failure.reason : null,
          },
        });

        if (failure.failed) {
          log.error(`${runtime} run failed: ${failure.reason}`, {
            apc_session: session.id,
            exit_code: r.exitCode,
            stderr: String(r.stderr || "").slice(0, 500),
            external_session_path: r.externalSessionPath || null,
          });
          return {
            error: `runtime "${runtime}" did not complete successfully: ${failure.reason}`,
            runtime,
            agent: agent?.slug || null,
            apc_session: session.id,
            exit_code: r.exitCode,
            stderr: (r.stderr || "").slice(0, 2000),
            output: (r.output || "").slice(0, 2000),
            external_session_path: r.externalSessionPath || null,
            session_id: r.sessionId || null,
          };
        }

        log.info(`${runtime} run ok`, {
          apc_session: session.id,
          exit_code: r.exitCode,
          external_session_path: r.externalSessionPath || null,
          session_id: r.sessionId || null,
          output_bytes: (r.output || "").length,
        });

        return {
          runtime,
          agent: agent?.slug || null,
          apc_session: session.id,
          exit_code: r.exitCode,
          result,
          output: (r.output || "").slice(0, 4000),
          stderr: (r.stderr || "").slice(0, 2000),
          truncated: (r.output || "").length > 4000,
          external_session_path: r.externalSessionPath || null,
          session_id: r.sessionId || null,
        };
      } catch (e) {
        log.error(`${runtime} run threw: ${e.message}`, { apc_session: session.id });
        try {
          closeRuntimeSession({
            filePath: session.path,
            exitCode: -1,
            result: `error: ${e.message.slice(0, 200)}`,
          });
        } catch {}
        return { error: `runtime "${runtime}" threw: ${e.message}`, runtime, agent: agent?.slug || null, apc_session: session.id };
      }
    };

    // Deliver a finished background run. Preferred path (A2A): feed the result
    // back into the super-agent so it relays in its own voice / chains the next
    // step — an internal agent-to-agent hand-off. Fallback: a direct channel
    // send of the raw result. Best-effort: never throws (nothing awaits it).
    const who = `${runtime}${agent ? ` (agente ${agent.slug})` : ""}`;
    const deliverCallback = async (res) => {
      // Take ownership of delivery: drop the durable IOU so the reconciler in
      // another/next daemon can't also deliver this one. Fallbacks below still
      // run in-process, so a delete here doesn't risk losing the callback.
      deletePendingCallback(session.id);
      const body = res.error ? "" : String(res.result || res.output || "").trim();

      if (backgroundResultSink) {
        // A2A report phrased for Roby (not the end user). Roby decides how to
        // relay it and whether a next step is needed.
        const report = res.error
          ? `[callback A2A] La tarea que delegaste a ${who} (sesión ${session.id}) FALLÓ: ${res.error}. ` +
            `Avisale al usuario en tu voz y proponé cómo seguir.`
          : `[callback A2A] Terminó la tarea que delegaste a ${who} (sesión ${session.id}). ` +
            `Resultado del agente:\n${body.slice(0, 6000)}\n\n` +
            `Contale al usuario el resultado en tu voz, breve y claro. No vuelvas a delegar salvo que falte un paso siguiente.`;
        try {
          await backgroundResultSink(report);
          log.info(`${runtime} callback relayed via A2A sink`, { apc_session: session.id });
          return;
        } catch (e) {
          log.error(`${runtime} A2A sink failed, falling back to direct send: ${e.message}`, { apc_session: session.id });
        }
      }

      if (!telegramPlugin) return;
      const head = res.error
        ? `⚠️ La sesión de ${who} terminó con error (sesión \`${session.id}\`): ${res.error}`
        : `✅ Terminó la sesión de ${who} (\`${session.id}\`).`;
      const text = body ? `${head}\n\n${body.slice(0, 3500)}` : head;
      try {
        await telegramPlugin.send({ channel: tgChannelName, chat_id: chatId, text });
        log.info(`${runtime} callback delivered (direct)`, { apc_session: session.id, chat_id: chatId });
      } catch (e) {
        log.error(`${runtime} callback send failed: ${e.message}`, { apc_session: session.id });
      }
    };

    if (runInBackground) {
      // Durable IOU: if this daemon dies before the run finishes (crash, pull,
      // or a task that restarts the daemon), the reconciler on the next daemon
      // delivers the result from the session record. The in-process path below
      // deletes it the moment it takes over. Only telegram delivery is wired.
      if (chatId != null) {
        writePendingCallback({
          session_id: session.id,
          session_path: session.path,
          channel: "telegram",
          chat_id: chatId,
          tg_channel: tgChannelName,
          runtime,
          agent: agent?.slug || null,
          who,
        });
      }
      // Fire-and-forget: don't await into the turn. runToCompletion never
      // rejects, so this promise is safe un-awaited; the result is pushed to the
      // chat when the runtime exits.
      runToCompletion().then(deliverCallback);
      return {
        runtime,
        agent: agent?.slug || null,
        apc_session: session.id,
        status: "launched",
        background: true,
        note:
          `La sesión de ${runtime} arrancó en segundo plano y puede tardar varios minutos u horas. ` +
          `NO esperes ni vuelvas a llamar a call_runtime para esto: el resultado llegará AUTOMÁTICAMENTE a este chat cuando termine. ` +
          `Respondé al usuario ahora, en una línea, avisándole que la lanzaste y que le vas a avisar acá cuando esté lista.`,
      };
    }

    return await runToCompletion();
  },
};
