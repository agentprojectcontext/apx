// Subprocess lifecycle for the persistent whisper-server.py.
//
// Owns:
//   - the Python child process (spawn, health-watch, kill on shutdown)
//   - port collision recovery (kill an orphan listener and retry)
//   - daemon-boot preload + warmup + graceful teardown
//
// Does NOT do the actual transcription — that's an HTTP call to localhost
// and lives in core/voice/transcription.js. The port number is the single
// piece of shared state and is exported from core; this file imports it.
import { spawn, exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WHISPER_LOCAL_PORT,
  DEFAULT_LOCAL,
  getConfig,
} from "#core/voice/transcription.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WHISPER_SERVER = path.join(__dirname, "whisper-server.py");

let _serverProcess = null;
let _serverModel = null;

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function _isServerHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function _serverModelName() {
  try {
    const res = await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.model || null;
  } catch {
    return null;
  }
}

async function _findListenerPid() {
  return new Promise((resolve) => {
    exec(`lsof -ti tcp:${WHISPER_LOCAL_PORT} -sTCP:LISTEN`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const candidates = stdout.trim().split("\n")
        .map(s => parseInt(s, 10))
        .filter(n => Number.isFinite(n) && n !== process.pid);
      resolve(candidates[0] || null);
    });
  });
}

async function _killOrphanWhisper() {
  try {
    await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/shutdown`, {
      method: "POST", signal: AbortSignal.timeout(1000),
    });
    await _sleep(600);
  } catch {}
  const pid = await _findListenerPid();
  if (pid && pid !== process.pid) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    await _sleep(400);
    try { process.kill(pid, 0); try { process.kill(pid, "SIGKILL"); } catch {} } catch {}
    await _sleep(300);
  }
}

export async function ensureWhisperServer(opts) {
  const model = opts.model || DEFAULT_LOCAL.model;

  if (_serverProcess && _serverModel === model) {
    if (await _isServerHealthy()) return;
    _serverProcess = null;
    _serverModel = null;
  }

  if (!_serverProcess) {
    const existing = await _serverModelName();
    if (existing === model) {
      _serverModel = model;
      return;
    }
    if (existing) {
      await _killOrphanWhisper();
    }
  }

  if (_serverProcess) {
    try { _serverProcess.kill(); } catch {}
    _serverProcess = null;
    _serverModel = null;
    await _sleep(300);
  }

  await _spawnWhisper(opts, model, /* retried */ false);
}

async function _spawnWhisper(opts, model, retried) {
  const args = [
    WHISPER_SERVER,
    "--port", String(WHISPER_LOCAL_PORT),
    "--model", model,
    "--device", String(opts.device || DEFAULT_LOCAL.device),
    "--compute-type", String(opts.compute_type || DEFAULT_LOCAL.compute_type),
    "--idle-minutes", String(opts.idle_minutes ?? DEFAULT_LOCAL.idle_minutes),
  ];

  const proc = spawn("python3", args, {
    stdio: ["ignore", "pipe", "inherit"],
    detached: false,
  });

  _serverProcess = proc;
  _serverModel = model;

  proc.on("exit", () => {
    if (_serverProcess === proc) {
      _serverProcess = null;
      _serverModel = null;
    }
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("whisper-server startup timed out (15s)")),
        15_000
      );
      let buf = "";
      proc.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        clearTimeout(timeout);
        try {
          const msg = JSON.parse(line);
          if (msg.status === "error") return reject(new Error(msg.error || "whisper-server error"));
          resolve();
        } catch {
          resolve();
        }
      });
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`whisper-server exited (code ${code}) before becoming ready`));
      });
    });
  } catch (e) {
    const msg = e.message || "";
    if (!retried && /address already in use|errno 48|eaddrinuse/i.test(msg)) {
      _serverProcess = null;
      _serverModel = null;
      await _killOrphanWhisper();
      return _spawnWhisper(opts, model, /* retried */ true);
    }
    throw e;
  }
}

export async function preloadWhisperServer(log = console.log) {
  try {
    const cfg = await getConfig();
    if (cfg.provider === "openai") return;
    log(`whisper: preloading model "${cfg.local.model}" on port ${WHISPER_LOCAL_PORT}…`);
    await ensureWhisperServer(cfg.local);
    log(`whisper: ready on port ${WHISPER_LOCAL_PORT} (model: ${_serverModel})`);
  } catch (e) {
    log(`whisper: preload failed — ${e.message} (will retry lazily on first request)`);
  }
}

export async function warmupWhisper() {
  try {
    const cfg = await getConfig();
    if (cfg.provider === "openai") return { ok: true, provider: "openai", loaded: false };
    await ensureWhisperServer(cfg.local);
    let loaded = false;
    try {
      const r = await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/warmup`, {
        signal: AbortSignal.timeout(40_000),
      });
      const j = await r.json().catch(() => ({}));
      loaded = !!j.loaded;
    } catch {}
    return { ok: true, provider: "local", model: _serverModel, loaded };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function shutdownWhisperServer() {
  if (_serverProcess) {
    try { _serverProcess.kill(); } catch {}
    _serverProcess = null;
    _serverModel = null;
  } else {
    try {
      await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/shutdown`, {
        method: "POST", signal: AbortSignal.timeout(500),
      });
    } catch {}
  }
}

export const WHISPER_PATHS = {
  whisper_server: WHISPER_SERVER,
  port: WHISPER_LOCAL_PORT,
};
