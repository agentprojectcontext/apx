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
import { register as registerVars } from "./api/vars.js";
import { register as registerMessages } from "./api/messages.js";
import { register as registerTelegram } from "./api/telegram.js";
import { register as registerPlugins } from "./api/plugins.js";
import { register as registerEngines } from "./api/engines.js";
import { register as registerSkills } from "./api/skills.js";
import { register as registerExec } from "./api/exec.js";
import { register as registerSuperAgent } from "./api/super-agent.js";
import { register as registerCode } from "./api/code.js";
import { register as registerConversations } from "./api/conversations.js";
import { register as registerConnections } from "./api/connections.js";
import { register as registerRuntimes } from "./api/runtimes.js";
import { register as registerRoutines } from "./api/routines.js";
import { register as registerArtifacts } from "./api/artifacts.js";
import { register as registerTasks } from "./api/tasks.js";
import { register as registerOrganization } from "./api/organization.js";
import { register as registerProjectFiles } from "./api/files-project.js";
import { register as registerConfig } from "./api/config.js";
import { register as registerRun } from "./api/run.js";
import { register as registerTopLevel } from "./api/top-level.js";
import { register as registerSessionsSearch } from "./api/sessions-search.js";
import { register as registerTranscribe } from "./api/transcribe.js";
import { register as registerTts } from "./api/tts.js";
import { register as registerEmbeddings } from "./api/embeddings.js";
import { register as registerVoice } from "./api/voice.js";
import { register as registerDesktop } from "./api/desktop.js";
import { register as registerDeck } from "./api/deck.js";
import { register as registerPairing } from "./api/pairing.js";
import { register as registerAdmin } from "./api/admin.js";
import { register as registerAdminConfig } from "./api/admin-config.js";
import { register as registerIdentity } from "./api/identity.js";
import { register as registerWeb } from "./api/web.js";
import { register as registerConfirm } from "./api/confirm.js";

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
  tokenStore,
}) {
  const telegram = plugins?.get("telegram");
  const app = express();

  // ---- Global middleware -------------------------------------------
  app.use(express.json({ limit: "2mb" }));
  app.use(traceIdMiddleware);
  // Prefer the multi-token store when provided (production path); fall
  // back to the single `token` argument for legacy callers and tests
  // that haven't migrated yet.
  if (tokenStore) app.use(buildAuthMiddleware(tokenStore));
  else if (token) app.use(buildAuthMiddleware(token));

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
    token,
    tokenStore,
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
  registerVars(app, ctx);
  registerMessages(app, ctx);
  registerEngines(app, ctx);
  registerSkills(app, ctx);
  registerExec(app, ctx);
  registerSuperAgent(app, ctx);
  registerConfirm(app, ctx);
  registerCode(app, ctx);
  registerConversations(app, ctx);
  registerConnections(app, ctx);
  registerRuntimes(app, ctx);
  registerRoutines(app, ctx);
  registerArtifacts(app, ctx);
  registerTasks(app, ctx);
  registerOrganization(app, ctx);
  registerProjectFiles(app, ctx);
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
  registerEmbeddings(app, ctx);
  registerVoice(app, ctx);
  registerDesktop(app, ctx);
  registerDeck(app, ctx);
  registerPairing(app, ctx);

  // ---- Admin -------------------------------------------------------
  registerAdmin(app, ctx);
  registerAdminConfig(app, ctx);
  registerIdentity(app, ctx);

  // ---- Web admin panel (static SPA, must mount before 404) ---------
  // Serves src/interfaces/web/dist when present + the /admin/web-token
  // localhost-only token endpoint. No-op until the panel is built.
  registerWeb(app, ctx);

  // ---- 404 catch-all (MUST be last) --------------------------------
  app.use((req, res) =>
    res.status(404).json({ error: `no route ${req.method} ${req.path}` })
  );

  return app;
}
