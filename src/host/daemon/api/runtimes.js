// External runtime adapters (claude-code, codex, opencode, aider, …) +
// session-resume that reads back what a runtime left on disk.
//
//   GET  /runtimes
//   GET  /env/detect
//   POST /projects/:pid/agents/:slug/runtime
//   GET  /projects/:pid/sessions/:id/resume?summarize=true
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "#core/apc/parser.js";
import { readSessionFrontmatter } from "#core/stores/sessions.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { CHANNELS } from "#core/constants/channels.js";
import { getRuntime, RUNTIME_IDS } from "../runtimes/index.js";
import { detectAll } from "../env-detect.js";
import {
  buildApfHint,
  createRuntimeSession,
  closeRuntimeSession,
  extractApfResult,
} from "../apc-runtime-context.js";
import { runSuperAgent, isSuperAgentEnabled } from "#core/agent/super-agent.js";

export function register(app, { projects, registries, plugins, project, config }) {
  app.get("/runtimes", (_req, res) =>
    res.json({ runtimes: RUNTIME_IDS })
  );

  app.get("/env/detect", async (_req, res) => {
    const detected = await detectAll();
    res.json(detected);
  });

  app.post("/projects/:pid/agents/:slug/runtime", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { runtime, prompt, timeoutMs } = req.body || {};
    if (!runtime || !prompt)
      return res.status(400).json({ error: "runtime and prompt required" });

    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });

    let rt;
    try {
      rt = getRuntime(runtime);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let projectName = path.basename(p.path);
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(p.path, ".apc", "project.json"), "utf8")
      );
      if (meta.name) projectName = meta.name;
    } catch {}

    const session = createRuntimeSession({
      projectRoot: p.path,
      storageRoot: p.storagePath,
      agentSlug: agent.slug,
      runtime,
      title: req.body?.title,
      taskRef: req.body?.task_ref || "",
    });

    const system = buildAgentSystem(p, agent, {
      invocation: "runtime",
      runtime,
      extraParts: [
        buildApfHint({
          projectName,
          projectPath: p.path,
          agentSlug: agent.slug,
          sessionId: session.id,
        }),
      ],
    });

    try {
      const r = await rt.run({
        system,
        prompt,
        cwd: p.path,
        timeoutMs: timeoutMs || 5 * 60 * 1000,
      });

      const apfResult =
        extractApfResult(r.output) || (r.output || "").slice(0, 200);
      closeRuntimeSession({
        filePath: session.path,
        externalSessionPath: r.externalSessionPath || null,
        exitCode: r.exitCode,
        result: apfResult,
      });

      p.logMessage({
        agent_slug: agent.slug,
        channel: "runtime",
        direction: "in",
        author: "user",
        body: prompt,
        meta: { runtime, apc_session: session.id },
      });
      p.logMessage({
        agent_slug: agent.slug,
        channel: "runtime",
        direction: "out",
        type: "agent",
        actor_id: agent.slug,
        actor_kind: "agent",
        author: agent.slug,
        body: r.output || "",
        meta: {
          runtime,
          exit_code: r.exitCode,
          external_session_path: r.externalSessionPath || null,
          session_id: r.sessionId || null,
          apc_session: session.id,
        },
      });
      projects.rebuild(p.id);

      res.json({
        runtime,
        exit_code: r.exitCode,
        output: r.output,
        stderr: r.stderr,
        external_session_path: r.externalSessionPath || null,
        session_id: r.sessionId || null,
        apc_session: session.id,
      });
    } catch (e) {
      try {
        closeRuntimeSession({
          filePath: session.path,
          exitCode: -1,
          result: `error: ${e.message.slice(0, 200)}`,
        });
      } catch {}
      res.status(500).json({ error: e.message, apc_session: session.id });
    }
  });

  // ---- Session resume — reads APC session file + (optionally) external transcript ----
  app.get("/projects/:pid/sessions/:id/resume", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { id } = req.params;

    const sessionRoots = [
      path.join(p.storagePath || p.path, "agents"),
      path.join(p.path, ".apc", "agents"),
    ];
    let sessionFile = null;
    let agentSlug = null;
    for (const agentsDir of sessionRoots) {
      if (!fs.existsSync(agentsDir)) continue;
      for (const slug of fs.readdirSync(agentsDir)) {
        const f = path.join(agentsDir, slug, "sessions", `${id}.md`);
        if (fs.existsSync(f)) {
          sessionFile = f;
          agentSlug = slug;
          break;
        }
      }
      if (sessionFile) break;
    }
    if (!sessionFile)
      return res.status(404).json({ error: `session ${id} not found` });

    const session = readSessionFrontmatter(sessionFile);
    const out = {
      id,
      agent: agentSlug,
      session_path: sessionFile,
      frontmatter: session?.fm || {},
      external_transcript: null,
      summary: null,
    };

    const externalPath = session?.fm?.external_session_path;
    if (externalPath && fs.existsSync(externalPath)) {
      const stat = fs.statSync(externalPath);
      const raw = fs.readFileSync(externalPath, "utf8");
      out.external_transcript = {
        path: externalPath,
        size: stat.size,
        tail: raw.length > 32 * 1024 ? raw.slice(-32 * 1024) : raw,
      };
    }

    if (req.query.summarize === "true" && isSuperAgentEnabled(config)) {
      try {
        const prompt =
          `Summarize what happened in this APC session in 4 concrete bullets.\n\n` +
          `Frontmatter:\n${JSON.stringify(out.frontmatter, null, 2)}\n\n` +
          (out.external_transcript
            ? `External transcript (last ${out.external_transcript.tail.length} chars):\n${out.external_transcript.tail}`
            : `(no external transcript)`);
        const sa = await runSuperAgent({
          globalConfig: config,
          projects,
          plugins,
          registries,
          prompt,
          channel: CHANNELS.API,
          contextNote: `Resume request for session ${id}.`,
        });
        out.summary = sa.text;
      } catch (e) {
        out.summary = `(super-agent failed: ${e.message})`;
      }
    }

    res.json(out);
  });
}
