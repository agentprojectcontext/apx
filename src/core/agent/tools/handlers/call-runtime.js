import fs from "node:fs";
import path from "node:path";
import { loggerFor } from "#core/logging.js";
import { readAgents } from "#core/apc/parser.js";
import {
  closeRuntimeSession,
  createRuntimeSession,
  extractRuntimeResult as extractApfResult,
} from "#core/stores/runtime-sessions.js";
import { buildRuntimeBridgeHint as buildApfHint } from "#core/agent/runtime-bridge.js";
import { detectAll } from "#host/daemon/env-detect.js";
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
    const meta = JSON.parse(fs.readFileSync(path.join(project.path, ".apc", "project.json"), "utf8"));
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
          timeout_s: { type: "integer", description: "seconds before SIGTERM; default 300" },
        },
        required: ["runtime", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent: slug, runtime, prompt, resume_session_id = null, timeout_s = 300, confirmed = false }) => {
    await requirePermission("call_runtime", { dangerous: true, confirmed, args: { runtime } });

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
      timeout_s,
    });

    try {
      const r = await rt.run({
        system: buildRuntimeSystem(p, agent, runtime, session.id, "super_agent_tool"),
        prompt: effectivePrompt,
        cwd: p.path,
        timeoutMs: timeout_s * 1000,
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
        output: (r.output || "").slice(0, 4000),
        stderr: (r.stderr || "").slice(0, 2000),
        truncated: (r.output || "").length > 4000,
        external_session_path: r.externalSessionPath || null,
        session_id: r.sessionId || null,
      };
    } catch (e) {
      log.error(`${runtime} run threw: ${e.message}`, {
        apc_session: session.id,
      });
      try {
        closeRuntimeSession({
          filePath: session.path,
          exitCode: -1,
          result: `error: ${e.message.slice(0, 200)}`,
        });
      } catch {}
      throw e;
    }
  },
};
