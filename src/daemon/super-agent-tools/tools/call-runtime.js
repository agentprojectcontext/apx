import { readAgents } from "../../../core/parser.js";
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

export default {
  name: "call_runtime",
  schema: {
    type: "function",
    function: {
      name: "call_runtime",
      description: "Spawn an external CLI runtime (Claude Code, Codex, OpenCode, Aider) impersonating an APC agent.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "APC agent slug from AGENTS.md, not runtime name" },
          runtime: {
            type: "string",
            enum: ["claude-code", "codex", "opencode", "aider"],
            description: "external CLI runtime",
          },
          prompt: { type: "string" },
          timeout_s: { type: "integer", description: "seconds before SIGTERM; default 300" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact runtime command"),
        },
        required: ["agent", "runtime", "prompt"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent: slug, runtime, prompt, timeout_s = 300, confirmed = false }) => {
    requirePermission("call_runtime", { dangerous: true, confirmed });

    const p = resolveProjectForAgent(projects, project, slug);
    const agent = readAgents(p.path).find((a) => a.slug === slug);
    if (!agent) {
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

    const r = await rt.run({
      system: buildAgentSystem(p, agent, {
        invocation: "runtime",
        runtime,
        caller: "super_agent_tool",
      }),
      prompt,
      cwd: p.path,
      timeoutMs: timeout_s * 1000,
    });

    p.logMessage({
      agent_slug: slug,
      channel: "runtime",
      direction: "in",
      author: "user",
      body: prompt,
      meta: { runtime, invoked_by: "super_agent_tool" },
    });
    p.logMessage({
      agent_slug: slug,
      channel: "runtime",
      direction: "out",
      author: slug,
      body: r.output || "",
      meta: {
        runtime,
        exit_code: r.exitCode,
        external_session_path: r.externalSessionPath || null,
        invoked_by: "super_agent_tool",
      },
    });

    return {
      runtime,
      exit_code: r.exitCode,
      output: (r.output || "").slice(0, 4000),
      truncated: (r.output || "").length > 4000,
      external_session_path: r.externalSessionPath || null,
    };
  },
};
