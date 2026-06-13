#!/usr/bin/env node
// APX daemon entry point. Boots config + projects + Express + plugins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  readConfig,
  writeConfig,
  effectiveHost,
  effectivePort,
  addProject as addProjectInConfig,
  PID_PATH,
  LOG_PATH,
  APX_HOME,
  TOKEN_PATH,
} from "#core/config/index.js";
import { ProjectManager } from "./db.js";
import { McpRegistry } from "#core/mcp/runner.js";
import { PluginManager } from "./plugins/index.js";
import { RoutineScheduler } from "./routines-scheduler.js";
import { buildApi } from "./api.js";
import { createTokenStore } from "./token-store.js";
import { triggerWakeup } from "./wakeup.js";
import { registerDesktopClient } from "./desktop-ws.js";
import { log as logToUnified } from "#core/logging.js";
import { initMemory, stopMemory } from "#core/memory/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")
);

// When the daemon is spawned detached by the CLI, stdout is already redirected
// to ~/.apx/daemon.log via `stdio: ["ignore", out, out]`. So a single
// process.stdout.write reaches the file once. In foreground (npm start), it
// still prints to the console. No double-append.
//
// Beyond the legacy stdout sink we also fan out every line to the unified
// ~/.apx/logs/apx.log via core/logging.js so `apx log` and `apx log -f`
// see everything that any plugin/module writes through the daemon's log fn.
//
// Heuristic for level/module inference: messages prefixed "fatal:" /
// "uncaughtException:" / "error:" are ERROR; "warn:" / "could not" / "skipping"
// are WARN; everything else INFO. Plugins normally pass `plugin <id> ...` or
// `<id>[<name>] ...` — we use the first bracketed token (or first word before
// ":") as the module tag.
function inferLevel(msg) {
  if (/^fatal:|^uncaughtException:|^error:|failed|crash/i.test(msg)) return "ERROR";
  if (/^warn:|could not|skipping|orphan|broken pipe/i.test(msg)) return "WARN";
  return "INFO";
}
function inferModule(msg) {
  // "plugin telegram initialized" → telegram
  const plug = msg.match(/^plugin\s+([a-z_-]+)/i);
  if (plug) return plug[1];
  // "telegram[default] ..." → telegram
  const bracket = msg.match(/^([a-z_-]+)\[/i);
  if (bracket) return bracket[1];
  // "whisper: preloading ..." → whisper
  const colon = msg.match(/^([a-z_-]+):\s/i);
  if (colon) return colon[1];
  // "overlay: ..." caught above; "loaded project ..." → daemon
  return "daemon";
}
const log = (msg) => {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
  try {
    logToUnified(inferLevel(msg), inferModule(msg), msg);
  } catch {
    // logger is best-effort, never throw
  }
};

function ensureHome() {
  fs.mkdirSync(APX_HOME, { recursive: true });
}

function writePid() {
  try {
    fs.writeFileSync(PID_PATH, String(process.pid));
  } catch {}
}

function pidIsAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimSingleton() {
  try {
    if (fs.existsSync(PID_PATH)) {
      const pid = parseInt(fs.readFileSync(PID_PATH, "utf8"), 10);
      if (pidIsAlive(pid)) {
        log(`fatal: apx-daemon already running with pid ${pid}`);
        process.exit(1);
      }
      fs.unlinkSync(PID_PATH);
    }
  } catch (e) {
    log(`fatal: cannot claim daemon pid file: ${e.message}`);
    process.exit(1);
  }
}

function clearPid() {
  try {
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  } catch {}
}

function generateToken() {
  const token = randomBytes(32).toString("hex");
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

class RegistryCache {
  constructor() {
    this.byProjectId = new Map();
  }
  ensure(projectEntry) {
    if (!this.byProjectId.has(projectEntry.id)) {
      this.byProjectId.set(
        projectEntry.id,
        new McpRegistry({
          projectPath: projectEntry.path,
          storagePath: projectEntry.storagePath || null,
        })
      );
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
  claimSingleton();
  const token = generateToken();

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

  const scheduler = new RoutineScheduler({
    projects,
    plugins,
    registries,
    globalConfig: cfg,
    log,
  });

  const tokenStore = createTokenStore({ masterToken: token });

  const startedAt = Date.now();
  const app = buildApi({
    projects,
    registries,
    plugins,
    scheduler,
    config: cfg,
    token,
    tokenStore,
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
    plugins.startAll();
    scheduler.start();
    // Cross-channel memory: ensure ~/.apx/memory.md exists, open the vector
    // store, and start the incremental RAG indexer. Best-effort — never blocks
    // boot and never throws into the daemon.
    initMemory({ config: cfg, log }).catch((e) => log(`memory: init failed: ${e?.message || e}`));
    // Skill Inspector: if enabled, refresh its vector index in the background so
    // any SKILL.md added/edited while the daemon was down is picked up without a
    // manual `apx skills index`. Best-effort; never blocks boot.
    (async () => {
      try {
        const { isInspectorEnabled } = await import("#core/agent/skills/inspector.js");
        if (!isInspectorEnabled(cfg)) return;
        const { backgroundRefreshIfStale } = await import("#core/agent/skills/index-store.js");
        const r = backgroundRefreshIfStale({
          embedOpts: { globalConfig: cfg },
          onDone: (out) => log(`skill inspector: index refreshed (${out.embedder}, +${out.changed.added.length} -${out.changed.removed.length} ~${out.changed.refreshed.length})`),
        });
        if (r.started) log(`skill inspector: reindexing ${r.missing} new / ${r.stale} stale / ${r.gone} gone skills…`);
      } catch (e) {
        log(`skill inspector: index refresh skipped (${e?.message || e})`);
      }
    })();
    // Fire wake-up message after a short delay so plugins (Telegram) are ready
    setTimeout(() => triggerWakeup(cfg, log), 3000);
    // Preload whisper-server in the background so first desktop transcription is fast.
    // Adopts an existing one if already on the port; otherwise spawns fresh.
    import("./whisper-server.js").then(({ preloadWhisperServer }) => {
      preloadWhisperServer((m) => log(m));
    }).catch(() => {});
  });

  // Attach WebSocket upgrade for the desktop channel on /desktop/ws
  // (legacy /overlay/ws still accepted for one release).
  server.on("upgrade", async (req, socket, head) => {
    if (req.url !== "/desktop/ws" && req.url !== "/overlay/ws") { socket.destroy(); return; }
    // Lazy-import ws to avoid hard dep on startup
    let WebSocketServer;
    try { ({ WebSocketServer } = await import("ws")); } catch {
      socket.destroy(); return;
    }
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (ws) => {
      registerDesktopClient(ws);
    });
  });

  server.on("error", (e) => {
    log(`fatal: listen ${host}:${port} failed: ${e.message}`);
    plugins.stopAll();
    registries.shutdown();
    clearPid();
    process.exit(1);
  });

  function shutdown(signal) {
    log(`received ${signal}, shutting down...`);
    scheduler.stop();
    plugins.stopAll();
    stopMemory();
    registries.shutdown();
    // Best-effort shutdown of whisper-server subprocess.
    import("./whisper-server.js").then(({ shutdownWhisperServer }) => {
      shutdownWhisperServer().catch(() => {});
    }).catch(() => {});
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
