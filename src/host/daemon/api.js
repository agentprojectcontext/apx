// Express REST API for APX. See APC docs reference/apx-daemon.
//
// Routes are split by domain under ./api/*.js — each module exports
// `register(router, ctx)`. This file is purely orchestration: middlewares,
// context construction, mount order, 404 catch-all.
//
// EVERY data route lives under /api. Domain modules still declare their paths
// root-relative (`/projects/:pid/tasks`); they register on an express.Router()
// that is mounted at API_PREFIX, so the effective URL is /api/projects/:pid/
// tasks. The root namespace belongs exclusively to the admin panel (static
// bundle + client-side routes), which is why the "is this an API path?" test
// is now a single startsWith instead of a hand-maintained prefix list.
import express from "express";

import { API_PREFIX } from "./api/prefix.js";
import { logError } from "#core/logging.js";

import {
  traceIdMiddleware,
  buildAuthMiddleware,
  makeProjectResolver,
  makeTopProjectResolver,
  errorMiddleware,
} from "./api/shared.js";

import { register as registerTools } from "./api/tools.js";
import { register as registerHealth } from "./api/health.js";
import { register as registerProjects } from "./api/projects.js";
import { register as registerAgents } from "./api/agents.js";
import { register as registerSessions } from "./api/sessions.js";
import { register as registerMcps } from "./api/mcps.js";
import { register as registerIntegrations } from "./api/integrations.js";
import { register as registerVars } from "./api/vars.js";
import { register as registerMedia } from "./api/media.js";
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
import { register as registerArtifactPreview } from "./api/artifact-preview.js";
import { register as registerTasks } from "./api/tasks.js";
import { register as registerCommitments } from "./api/commitments.js";
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
import { register as registerProfiles } from "./api/profiles.js";
import { register as registerInbox } from "./api/inbox.js";
import { register as registerSelfMemory } from "./api/self-memory.js";
import { register as registerNudges } from "./api/nudges.js";
import { register as registerWeb, registerWebToken } from "./api/web.js";
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
  // Every domain module registers on this router; it is mounted at /api at the
  // bottom of this function. Modules keep declaring root-relative paths.
  const api = express.Router();

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
  registerTools(api, ctx);

  // ---- Health (unauthenticated) ------------------------------------
  registerHealth(api, ctx);

  // ---- Projects + per-project surfaces -----------------------------
  registerProjects(api, ctx);
  registerAgents(api, ctx);
  registerSessions(api, ctx);
  registerMcps(api, ctx);
  registerIntegrations(api, ctx);
  registerVars(api, ctx);
  registerMedia(api);
  registerMessages(api, ctx);
  registerEngines(api, ctx);
  registerSkills(api, ctx);
  registerExec(api, ctx);
  registerSuperAgent(api, ctx);
  registerConfirm(api, ctx);
  registerCode(api, ctx);
  registerConversations(api, ctx);
  registerConnections(api, ctx);
  registerRuntimes(api, ctx);
  registerRoutines(api, ctx);
  registerArtifacts(api, ctx);
  registerArtifactPreview(api, ctx);
  registerTasks(api, ctx);
  registerCommitments(api, ctx);
  registerOrganization(api, ctx);
  registerProjectFiles(api, ctx);
  registerConfig(api, ctx);

  // ---- Top-level shortcuts (MCP server clients) --------------------
  registerRun(api, ctx);
  registerTopLevel(api, ctx);
  registerSessionsSearch(api, ctx);

  // ---- Channels & plugin surfaces ----------------------------------
  registerTelegram(api, ctx);
  registerPlugins(api, ctx);
  registerTranscribe(api, ctx);
  registerTts(api, ctx);
  registerEmbeddings(api, ctx);
  registerVoice(api, ctx);
  registerDesktop(api, ctx);
  registerDeck(api, ctx);
  registerPairing(api, ctx);

  // ---- Admin -------------------------------------------------------
  registerAdmin(api, ctx);
  registerAdminConfig(api, ctx);
  registerIdentity(api, ctx);
  registerProfiles(api, ctx);
  registerInbox(api, ctx);
  registerSelfMemory(api, ctx);
  registerNudges(api, ctx);
  registerWebToken(api, ctx);

  // ---- API 404 (MUST be last on the router) ------------------------
  // Terminal for the /api namespace: an unknown /api/* path answers JSON here
  // instead of falling through to the SPA shell below.
  api.use((req, res) =>
    res.status(404).json({ error: `no route ${req.method} ${req.baseUrl}${req.path}` })
  );

  app.use(API_PREFIX, api);

  // ---- Web admin panel (static SPA, must mount after /api) ---------
  // Serves src/interfaces/web/dist when present. No-op until the panel is built.
  registerWeb(app, ctx);

  // ---- 404 catch-all (MUST be last) --------------------------------
  app.use((req, res) =>
    res.status(404).json({ error: `no route ${req.method} ${req.path}` })
  );

  // ---- Error handler (MUST be after everything) --------------------
  // Express only recognises the 4-argument shape, and only when it is mounted
  // last. Anything an asyncRoute() rejects lands here as JSON instead of an
  // unhandled rejection that kills the daemon.
  app.use(errorMiddleware(logError));

  return app;
}
