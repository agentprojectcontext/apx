#!/usr/bin/env node
// APX daemon entry point. Boots config + projects + Express + plugins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readConfig,
  writeConfig,
  effectiveHost,
  effectivePort,
  addProject as addProjectInConfig,
  PID_PATH,
  LOG_PATH,
  APX_HOME,
} from "../core/config.js";
import { ProjectManager } from "./db.js";
import { McpRegistry } from "./mcp-runner.js";
import { PluginManager } from "./plugins/index.js";
import { RoutineScheduler } from "./routines.js";
import { buildApi } from "./api.js";
import { triggerWakeup } from "./wakeup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
);

// When the daemon is spawned detached by the CLI, stdout is already redirected
// to ~/.apx/daemon.log via `stdio: ["ignore", out, out]`. So a single
// process.stdout.write reaches the file once. In foreground (npm start), it
// still prints to the console. No double-append.
const log = (msg) => {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
};

function ensureHome() {
  fs.mkdirSync(APX_HOME, { recursive: true });
}

function writePid() {
  try {
    fs.writeFileSync(PID_PATH, String(process.pid));
  } catch {}
}

function clearPid() {
  try {
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  } catch {}
}

class RegistryCache {
  constructor() {
    this.byProjectId = new Map();
  }
  ensure(projectEntry) {
    if (!this.byProjectId.has(projectEntry.id)) {
      this.byProjectId.set(projectEntry.id, new McpRegistry(projectEntry.path));
    }
    return this.byProjectId.get(projectEntry.id);
  }
  for(projectEntry) {
    return this.ensure(projectEntry);
  }
  shutdown() {
    for (const r of this.byProjectId.values()) r.shutdown();
    this.byProjectId.clear();
  }
}

async function main() {
  ensureHome();

  const cfg = readConfig();
  const host = effectiveHost(cfg);
  const port = effectivePort(cfg);

  const projects = new ProjectManager(cfg);
  const registries = new RegistryCache();

  // Default project (id=0) is always available — no local .apc/ required.
  projects.registerDefault();

  // Load registered projects from config.
  for (const entry of cfg.projects) {
    try {
      const p = projects.register(entry.path);
      registries.ensure(p);
      log(`loaded project #${p.id} ${p.path}`);
    } catch (e) {
      log(`skipping project ${entry.path}: ${e.message}`);
    }
  }

  const plugins = new PluginManager({ projects, config: cfg, log, registries });
  plugins.initAll();
  plugins.startAll();

  const scheduler = new RoutineScheduler({
    projects,
    plugins,
    globalConfig: cfg,
    log,
  });
  scheduler.start();

  const startedAt = Date.now();
  const app = buildApi({
    projects,
    registries,
    plugins,
    scheduler,
    config: cfg,
    version: PKG.version,
    startedAt,
    addProjectGlobally: (absPath) => {
      try {
        const fresh = readConfig();
        addProjectInConfig(fresh, absPath);
      } catch (e) {
        log(`could not persist project to global config: ${e.message}`);
      }
    },
  });

  plugins.installRoutes(app);

  const server = app.listen(port, host, () => {
    writePid();
    log(`apx-daemon ${PKG.version} listening on http://${host}:${port}`);
    log(`projects: ${projects.list().length} | plugins: ${Object.keys(plugins.status()).join(", ") || "(none)"}`);
    // Fire wake-up message after a short delay so plugins (Telegram) are ready
    setTimeout(() => triggerWakeup(cfg, log), 3000);
  });

  function shutdown(signal) {
    log(`received ${signal}, shutting down...`);
    scheduler.stop();
    plugins.stopAll();
    registries.shutdown();
    server.close(() => {
      clearPid();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (e) => {
    log(`uncaughtException: ${e.stack || e.message}`);
  });
}

main().catch((e) => {
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
