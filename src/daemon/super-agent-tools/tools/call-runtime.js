import fs from "node:fs";
import path from "node:path";
import { readAgents } from "../../../core/parser.js";
import {
  buildApfHint,
  closeRuntimeSession,
  createRuntimeSession,
  extractApfResult,
} from "../../apc-runtime-context.js";
import { detectAll } from "../../env-detect.js";
import { runProcess } from "../../runtimes/_spawn.js";
import { getRuntime, RUNTIME_IDS } from "../../runtimes/index.js";
import { buildAgentSystem, confirmedProperty, resolveProject } from "../helpers.js";

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
  const agentSlug = agent?.slug || "super-agent";
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
          timeout_s: { type: "integer", description: "seconds before SIGTERM; default 300" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact runtime command"),
        },
        required: ["runtime", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent: slug, runtime, prompt, timeout_s = 300, confirmed = false }) => {
    requirePermission("call_runtime", { dangerous: true, confirmed });

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

  const actor = agent?.slug || "super-agent";
    const session = createRuntimeSession({
      projectRoot: p.path,
      storageRoot: p.storagePath,
      agentSlug: actor,
      runtime,
      title: `Runtime: ${runtime}${agent ? ` (${agent.slug})` : ""}`,
    });

    try {
      const r = await rt.run({
        system: buildRuntimeSystem(p, agent, runtime, session.id, "super_agent_tool"),
        prompt,
        cwd: p.path,
        timeoutMs: timeout_s * 1000,
      });

      const result = extractApfResult(r.output) || (r.output || "").slice(0, 200);
      closeRuntimeSession({
        filePath: session.path,
        externalSessionPath: r.externalSessionPath || null,
        exitCode: r.exitCode,
        result,
      });

      p.logMessage({
        agent_slug: actor,
        channel: "runtime",
        direction: "in",
        author: "user",
        body: prompt,
        meta: { runtime, invoked_by: "super_agent_tool", apc_session: session.id },
      });
      p.logMessage({
        agent_slug: actor,
        channel: "runtime",
        direction: "out",
        author: actor,
        body: r.output || "",
        meta: {
          runtime,
          exit_code: r.exitCode,
          external_session_path: r.externalSessionPath || null,
          session_id: r.sessionId || null,
          apc_session: session.id,
          invoked_by: "super_agent_tool",
        },
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
