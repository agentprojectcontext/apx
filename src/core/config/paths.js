// Filesystem layout for the APX home directory. Re-exported by config/index.js
// for back-compat; new code can import directly from here for paths-only work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where APX keeps everything. `APX_HOME` in the environment relocates it —
 * useful for sandboxes and required by tests that need an isolated home.
 *
 * Resolve lazily when a caller can be reached after the environment changes
 * (tests stub os.homedir mid-run); the eager `APX_HOME` constant below is the
 * common case and stays for the ~30 call sites that read it at import time.
 */
export function apxHome() {
  return process.env.APX_HOME || path.join(os.homedir(), ".apx");
}

export const APX_HOME = apxHome();
export const CONFIG_PATH = path.join(APX_HOME, "config.json");
export const PID_PATH = path.join(APX_HOME, "daemon.pid");
export const LOG_PATH = path.join(APX_HOME, "daemon.log");
export const TELEGRAM_STATE_PATH = path.join(APX_HOME, "telegram-state.json");
export const TOKEN_PATH = path.join(APX_HOME, "daemon.token");

// Global channel messages (telegram, direct, whatsapp, …) live here,
// separated from any project. Structure: ~/.apx/messages/<channel>/YYYY-MM-DD.jsonl
export const GLOBAL_MESSAGES_DIR = path.join(APX_HOME, "messages");

// Per-project runtime storage (conversations, sessions) — never in the repo.
// Structure: ~/.apx/projects/<apx_id>/agents/<slug>/conversations/
export const PROJECT_STORE_ROOT = path.join(APX_HOME, "projects");
export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_STORE = path.join(PROJECT_STORE_ROOT, DEFAULT_PROJECT_ID);

// ---------------------------------------------------------------------------
// Everything else under ~/.apx.
//
// These used to be rebuilt from os.homedir() at ~30 call sites, several of them
// duplicated across modules that then drifted: the TTS scratch dir existed in
// core/voice/tts.js *and* api/voice.js, the desktop log in core/desktop/
// process.js *and* cli/commands/desktop.js, the log paths in core/logging.js
// *and* cli/commands/log.js. One definition each, imported everywhere.
// ---------------------------------------------------------------------------

/** The super-agent's own notebook (see core/agent/self-memory.js). */
export const SELF_MEMORY_PATH = path.join(APX_HOME, "memory.md");
/** Who the super-agent is: name, personality, owner. */
export const IDENTITY_PATH = path.join(APX_HOME, "identity.json");

/** User-installed skills and the RAG index built over them. */
export const SKILLS_DIR = path.join(APX_HOME, "skills");
export const SKILLS_INDEX_PATH = path.join(SKILLS_DIR, ".index.json");

/** Agent vault — reusable agent definitions, not tied to one project. */
export const AGENT_VAULT_DIR = path.join(APX_HOME, "agents");

/** Unified log tree. Everything writes here so one tail follows the system. */
export const LOG_DIR = path.join(APX_HOME, "logs");
export const APX_LOG_PATH = path.join(LOG_DIR, "apx.log");
export const ERROR_TRACE_PATH = path.join(LOG_DIR, "errors.jsonl");

/** Desktop capsule (Electron) runtime state. */
export const DESKTOP_PID_PATH = path.join(APX_HOME, "desktop.pid");
export const DESKTOP_LOG_PATH = path.join(APX_HOME, "desktop.log");
export const DESKTOP_AUTOSTART_LOG_PATH = path.join(APX_HOME, "desktop-autostart.log");

/** Scratch space. Safe to delete between runs. */
export const TMP_DIR = path.join(APX_HOME, "tmp");
export const TTS_TMP_DIR = path.join(TMP_DIR, "tts");
export const RECORDINGS_TMP_DIR = path.join(TMP_DIR, "recordings");

/** Managed runtimes we install on the user's behalf. */
export const RUNTIME_DIR = path.join(APX_HOME, "runtime");
export const WHISPER_VENV_DIR = path.join(RUNTIME_DIR, "whisper-venv");

export function projectStorageRoot(apxId) {
  return path.join(PROJECT_STORE_ROOT, apxId);
}

export function ensureProjectStorage(apxId) {
  const root = projectStorageRoot(apxId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
