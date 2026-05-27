// Express REST API for APX. See APC docs reference/apx-daemon.
//
// Routes are split by domain under ./api/*.js — each module exports
// `register(app, ctx)`. This file is purely orchestration: middlewares,
// context construction, mount order, 404 catch-all.
import express from "express";

import {
  traceIdMiddleware,
  buildAuthMiddleware,
  makeProjectResolver,
  makeTopProjectResolver,
} from "./api/shared.js";

import { register as registerTools } from "./api/tools.js";
import { register as registerHealth } from "./api/health.js";
import { register as registerProjects } from "./api/projects.js";
import { register as registerAgents } from "./api/agents.js";
import { register as registerSessions } from "./api/sessions.js";
import { register as registerMcps } from "./api/mcps.js";
import { register as registerMessages } from "./api/messages.js";
import { register as registerTelegram } from "./api/telegram.js";
import { register as registerPlugins } from "./api/plugins.js";
import { register as registerEngines } from "./api/engines.js";
import { register as registerExec } from "./api/exec.js";
import { register as registerSuperAgent } from "./api/super-agent.js";
import { register as registerConversations } from "./api/conversations.js";
import { register as registerConnections } from "./api/connections.js";
import { register as registerRuntimes } from "./api/runtimes.js";
import { register as registerRoutines } from "./api/routines.js";
import { register as registerArtifacts } from "./api/artifacts.js";
import { register as registerTasks } from "./api/tasks.js";
import { register as registerConfig } from "./api/config.js";
import { register as registerRun } from "./api/run.js";
import { register as registerTopLevel } from "./api/top-level.js";
import { register as registerSessionsSearch } from "./api/sessions-search.js";
import { register as registerTranscribe } from "./api/transcribe.js";
import { register as registerTts } from "./api/tts.js";
import { register as registerVoice } from "./api/voice.js";
import { register as registerOverlay } from "./api/overlay.js";
import { register as registerDeck } from "./api/deck.js";
import { register as registerAdmin } from "./api/admin.js";

export function buildApi({
  projects,
  registries,
  plugins,
  scheduler,
  version,
  startedAt,
  addProjectGlobally,
  config,
  token,
}) {
  const telegram = plugins?.get("telegram");
  const app = express();

  // ---- Global middleware -------------------------------------------
  app.use(express.json({ limit: "2mb" }));
  app.use(traceIdMiddleware);
  if (token) app.use(buildAuthMiddleware(token));

  // ---- Shared resolvers (closed over `projects`) -------------------
  const project = makeProjectResolver(projects);
  const resolveTopProject = makeTopProjectResolver(projects);

  // ---- Context passed to every domain register() -------------------
  const ctx = {
    express,
    projects,
    registries,
    plugins,
    scheduler,
    telegram,
    version,
    startedAt,
    addProjectGlobally,
    config,
    project,
    resolveTopProject,
  };

  // ---- Tool routers — must mount BEFORE wildcard registry below ----
  registerTools(app, ctx);

  // ---- Health (unauthenticated) ------------------------------------
  registerHealth(app, ctx);

  // ---- Projects + per-project surfaces -----------------------------
  registerProjects(app, ctx);
  registerAgents(app, ctx);
  registerSessions(app, ctx);
  registerMcps(app, ctx);
  registerMessages(app, ctx);
  registerEngines(app, ctx);
  registerExec(app, ctx);
  registerSuperAgent(app, ctx);
  registerConversations(app, ctx);
  registerConnections(app, ctx);
  registerRuntimes(app, ctx);
  registerRoutines(app, ctx);
  registerArtifacts(app, ctx);
  registerTasks(app, ctx);
  registerConfig(app, ctx);

  // ---- Top-level shortcuts (MCP server clients) --------------------
  registerRun(app, ctx);
  registerTopLevel(app, ctx);
  registerSessionsSearch(app, ctx);

  // ---- Channels & plugin surfaces ----------------------------------
  registerTelegram(app, ctx);
  registerPlugins(app, ctx);
  registerTranscribe(app, ctx);
  registerTts(app, ctx);
  registerVoice(app, ctx);
  registerOverlay(app, ctx);
  registerDeck(app, ctx);

  // ---- Admin -------------------------------------------------------
  registerAdmin(app, ctx);

  // ---- 404 catch-all (MUST be last) --------------------------------
  app.use((req, res) =>
    res.status(404).json({ error: `no route ${req.method} ${req.path}` })
  );

  return app;
}
