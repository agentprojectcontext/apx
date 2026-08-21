// Filesystem layout for the APX home directory. Re-exported by config/index.js
// for back-compat; new code can import directly from here for paths-only work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where APX keeps everything. `APX_HOME` in the environment relocates it —
 * useful for sandboxes and required by tests that need an isolated home.
 */
function computeHome() {
  return process.env.APX_HOME || path.join(os.homedir(), ".apx");
}

// ---------------------------------------------------------------------------
// The paths below are `let`, not `const`, and that is the whole point.
//
// They used to be frozen at import: whichever module reached this file first
// decided where ~/.apx was for the rest of the process. That made test
// isolation a RACE — a test that relocates APX_HOME inside its body only won if
// nothing had imported config before it, which depends on module-graph order
// and, under a parallel runner, on which files happen to share a process. Two
// suites flaked on exactly that (tests/admin-reload, tests/commitments-api):
// they wrote a fixture config into a temp home and then read the developer's
// real one.
//
// An ES module export is a LIVE BINDING, so reassigning here updates every
// importer — including ones that imported before the change — with no call-site
// changes and no accessor cost. Importers still cannot assign: the binding is
// read-only on their side, so `let` costs nothing in safety.
//
// Call `syncPaths()` after changing APX_HOME (or HOME). `apxHome()` and
// `ensureHome()` already do, which covers readConfig/writeConfig and therefore
// nearly everything.
// ---------------------------------------------------------------------------

export let APX_HOME = computeHome();
export let CONFIG_PATH;
export let PID_PATH;
export let LOG_PATH;
export let TELEGRAM_STATE_PATH;
export let TOKEN_PATH;

// Global channel messages (telegram, direct, whatsapp, …) live here,
// separated from any project. Structure: ~/.apx/messages/<channel>/YYYY-MM-DD.jsonl
export let GLOBAL_MESSAGES_DIR;

// Per-project runtime storage (conversations, sessions) — never in the repo.
// Structure: ~/.apx/projects/<apx_id>/agents/<slug>/conversations/
export let PROJECT_STORE_ROOT;
export const DEFAULT_PROJECT_ID = "default";
export let DEFAULT_PROJECT_STORE;

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
export let SELF_MEMORY_PATH;
/** Who the super-agent is: name, personality, owner. */
export let IDENTITY_PATH;

/** User-installed skills and the RAG index built over them. */
export let SKILLS_DIR;
export let SKILLS_INDEX_PATH;

/** Agent vault — reusable agent definitions, not tied to one project. */
export let AGENT_VAULT_DIR;

/** Ledger of unrequested outbound messages and the user's feedback on them. */
export let NUDGES_PATH;
/** Mobility preferences such as "do not mention more trips today". */
export let MOBILITY_PATH;

/** Unified log tree. Everything writes here so one tail follows the system. */
export let LOG_DIR;
export let APX_LOG_PATH;
export let ERROR_TRACE_PATH;

/** Desktop capsule (Electron) runtime state. */
export let DESKTOP_PID_PATH;
export let DESKTOP_LOG_PATH;
export let DESKTOP_AUTOSTART_LOG_PATH;

/** Scratch space. Safe to delete between runs. */
export let TMP_DIR;
export let TTS_TMP_DIR;
export let RECORDINGS_TMP_DIR;

/** Managed runtimes we install on the user's behalf. */
export let RUNTIME_DIR;
export let WHISPER_VENV_DIR;

/** Derive every path under the home. Order matters where one nests in another. */
function rebuild(home) {
  APX_HOME = home;
  CONFIG_PATH = path.join(home, "config.json");
  PID_PATH = path.join(home, "daemon.pid");
  LOG_PATH = path.join(home, "daemon.log");
  TELEGRAM_STATE_PATH = path.join(home, "telegram-state.json");
  TOKEN_PATH = path.join(home, "daemon.token");
  GLOBAL_MESSAGES_DIR = path.join(home, "messages");
  PROJECT_STORE_ROOT = path.join(home, "projects");
  DEFAULT_PROJECT_STORE = path.join(PROJECT_STORE_ROOT, DEFAULT_PROJECT_ID);
  SELF_MEMORY_PATH = path.join(home, "memory.md");
  IDENTITY_PATH = path.join(home, "identity.json");
  SKILLS_DIR = path.join(home, "skills");
  SKILLS_INDEX_PATH = path.join(SKILLS_DIR, ".index.json");
  AGENT_VAULT_DIR = path.join(home, "agents");
  NUDGES_PATH = path.join(home, "nudges.json");
  MOBILITY_PATH = path.join(home, "mobility.json");
  LOG_DIR = path.join(home, "logs");
  APX_LOG_PATH = path.join(LOG_DIR, "apx.log");
  ERROR_TRACE_PATH = path.join(LOG_DIR, "errors.jsonl");
  DESKTOP_PID_PATH = path.join(home, "desktop.pid");
  DESKTOP_LOG_PATH = path.join(home, "desktop.log");
  DESKTOP_AUTOSTART_LOG_PATH = path.join(home, "desktop-autostart.log");
  TMP_DIR = path.join(home, "tmp");
  TTS_TMP_DIR = path.join(TMP_DIR, "tts");
  RECORDINGS_TMP_DIR = path.join(TMP_DIR, "recordings");
  RUNTIME_DIR = path.join(home, "runtime");
  WHISPER_VENV_DIR = path.join(RUNTIME_DIR, "whisper-venv");
}

rebuild(APX_HOME);

/**
 * Point every path at wherever the home is NOW.
 *
 * Production never needs this — the environment is fixed at boot — but a test
 * that relocates APX_HOME (or stubs os.homedir, or moves HOME) after this
 * module has loaded does, and calling it is deterministic where relying on
 * import order was not.
 *
 * @returns {boolean} whether anything moved.
 */
export function syncPaths() {
  const next = computeHome();
  if (next === APX_HOME) return false;
  rebuild(next);
  return true;
}

/** The home, guaranteed current. */
export function apxHome() {
  syncPaths();
  return APX_HOME;
}

export function projectStorageRoot(apxId) {
  return path.join(PROJECT_STORE_ROOT, apxId);
}

export function ensureProjectStorage(apxId) {
  const root = projectStorageRoot(apxId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
