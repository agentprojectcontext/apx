// Per-project config — overrides specific sections of the global
// ~/.apx/config.json *only when serving that project*.
//
// WHERE IT LIVES: `~/.apx/projects/<apx_id>/config.json`, next to the rest of
// that project's runtime state. It used to live at `<repo>/.apc/config.json`,
// which is a COMMITTED path: one `apx config set engines.zen.api_key …` inside
// a project and the credential was staged for the next push. The file is now
// machine-local by construction, so no amount of fumbling the scope can leak a
// key into someone's repo. `.apc/` keeps the portable, reviewable half —
// project.json, agents, skills, organization — and nothing else.
//
// Projects configured before the move are migrated on first read (see
// migrateLegacyConfig): the old file is moved, not copied, because leaving it
// behind is exactly the leak this closes. It stays recoverable from git.
//
// Shape (every section optional):
//   {
//     "telegram": {
//       "bot_token": "...",        // override global bot
//       "chat_id":   "...",        // override global chat
//       "route_to_agent": "sofia", // who replies to inbound for THIS project
//       "respond_with_engine": true
//     },
//     "engines": {
//       "ollama":    { "base_url": "http://localhost:11434" },
//       "anthropic": { "api_key":  "..." }
//     },
//     "routines": [
//       { "name": "morning-report", "schedule": "0 9 * * *", "agent": "sofia",
//         "prompt": "Previous day summary", "channel": "telegram" }
//     ]
//   }
//
// Resolution rule (deep merge): project wins on conflict, but only at leaf
// keys — arrays are replaced wholesale, primitives override, objects recurse.

import fs from "node:fs";
import path from "node:path";
import { projectConfigFile, legacyProjectConfigFile } from "#core/config/paths.js";
import { apcProjectFile } from "#core/apc/paths.js";

/** The committed location this config used to have. Read-only from here on. */
export const LEGACY_PROJECT_CONFIG_REL = ".apc/config.json";

export const legacyProjectConfigPath = legacyProjectConfigFile;

/**
 * The project's stable storage id, read (never created) from .apc/project.json.
 * A registered project always has one — db.register() calls getOrCreateApxId
 * before anything reads the config — so a null here means "not a project",
 * and the caller falls back to the legacy path rather than inventing storage.
 */
function readApxId(projectRoot) {
  try {
    const meta = JSON.parse(fs.readFileSync(apcProjectFile(projectRoot), "utf8"));
    const id = typeof meta?.apx_id === "string" ? meta.apx_id.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

export function projectConfigPath(projectRoot) {
  return projectConfigFile(projectRoot, readApxId(projectRoot));
}

function readJsonObject(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Move a pre-relocation `.apc/config.json` into the project's storage. The
 * delete only happens once the new file is on disk, so a failure here leaves
 * the old file intact rather than dropping the settings on the floor.
 */
function migrateLegacyConfig(projectRoot, target, legacy) {
  const cfg = readJsonObject(legacy) || {};
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + "\n");
    fs.unlinkSync(legacy);
    console.log(`[apx] moved ${legacy} → ${target} (project config is machine-local now)`);
  } catch (e) {
    console.warn(`[apx] could not move ${legacy} → ${target}: ${e.message}`);
  }
  return cfg;
}

export function readProjectConfig(projectRoot) {
  const target = projectConfigPath(projectRoot);
  const legacy = legacyProjectConfigPath(projectRoot);
  if (target !== legacy && !fs.existsSync(target) && fs.existsSync(legacy)) {
    return migrateLegacyConfig(projectRoot, target, legacy);
  }
  return readJsonObject(target) || {};
}

export function writeProjectConfig(projectRoot, cfg) {
  const target = projectConfigPath(projectRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + "\n");
  // A save is also a migration: whatever is still sitting in the repo would
  // otherwise be re-adopted on the next read and undo this write.
  const legacy = legacyProjectConfigPath(projectRoot);
  if (target !== legacy && fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
      console.log(`[apx] removed ${legacy} (project config lives in ${target})`);
    } catch {
      // Read-only checkout: the next read still prefers the new file.
    }
  }
}

// Deep-merge `a` (lower priority) and `b` (higher priority). Arrays in `b`
// replace arrays in `a`. Plain objects recurse. Anything else: `b` wins.
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (b === null || b === undefined) return a;
  if (typeof b !== "object") return b;
  if (typeof a !== "object" || Array.isArray(a) || a === null) return { ...b };
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = deepMerge(a[k], b[k]);
  }
  return out;
}

// Compute the effective config for a project: global, then project overrides.
export function effectiveConfig(globalConfig, projectRoot) {
  const project = readProjectConfig(projectRoot);
  return deepMerge(globalConfig, project);
}

// Set a dotted key path in the project config. Creates intermediate objects.
//   setKey(cfg, "telegram.route_to_agent", "sofia")
export function setDottedKey(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nextKey = parts[i + 1];
    if (Array.isArray(cur)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0) return obj;
      if (typeof cur[idx] !== "object" || cur[idx] === null) {
        cur[idx] = /^\d+$/.test(nextKey) ? [] : {};
      }
      cur = cur[idx];
      continue;
    }
    if (typeof cur[k] !== "object" || cur[k] === null) {
      cur[k] = /^\d+$/.test(nextKey) ? [] : {};
    }
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (Number.isInteger(idx) && idx >= 0) cur[idx] = value;
  } else {
    cur[last] = value;
  }
  return obj;
}

export function unsetDottedKey(obj, dottedKey) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (Array.isArray(cur)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || typeof cur[idx] !== "object") return false;
      cur = cur[idx];
      continue;
    }
    if (typeof cur[key] !== "object") return false;
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  if (last in cur) {
    delete cur[last];
    return true;
  }
  return false;
}
