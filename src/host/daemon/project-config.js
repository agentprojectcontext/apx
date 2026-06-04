// Per-project config (.apc/config.json) — overrides specific sections of the
// global ~/.apx/config.json *only when serving that project*.
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

export const PROJECT_CONFIG_REL = ".apc/config.json";

export function projectConfigPath(projectRoot) {
  return path.join(projectRoot, PROJECT_CONFIG_REL);
}

export function readProjectConfig(projectRoot) {
  const p = projectConfigPath(projectRoot);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

export function writeProjectConfig(projectRoot, cfg) {
  const p = projectConfigPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
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
