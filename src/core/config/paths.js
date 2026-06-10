// Filesystem layout for the APX home directory. Re-exported by config/index.js
// for back-compat; new code can import directly from here for paths-only work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APX_HOME = path.join(os.homedir(), ".apx");
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

export function projectStorageRoot(apxId) {
  return path.join(PROJECT_STORE_ROOT, apxId);
}

export function ensureProjectStorage(apxId) {
  const root = projectStorageRoot(apxId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
