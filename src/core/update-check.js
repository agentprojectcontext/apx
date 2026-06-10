// Update checker — non-blocking, cached 24h.
// On each command: reads cache → shows message if newer version exists.
// In background: refreshes cache from npm registry (fire-and-forget).
// Never slows down the main command.

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { APX_HOME } from "./config/index.js";

const PACKAGE_NAME = "@agentprojectcontext/apx";
const CACHE_PATH = path.join(APX_HOME, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data) + "\n");
  } catch {}
}

// Compare semver strings. Returns true if `latest` > `current`.
function isNewer(current, latest) {
  if (!current || !latest) return false;
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [ma, mi, pa] = parse(current);
  const [mb, mib, pb] = parse(latest);
  if (mb > ma) return true;
  if (mb === ma && mib > mi) return true;
  if (mb === ma && mib === mi && pb > pa) return true;
  return false;
}

// Fetch latest version from npm registry (async, no deps).
function fetchLatest() {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// Fire-and-forget background refresh. Never awaited by the caller.
function refreshInBackground(currentVersion) {
  fetchLatest().then((latest) => {
    if (latest) {
      writeCache({ latest, current: currentVersion, checkedAt: Date.now() });
    }
  }).catch(() => {});
}

// Call this at the END of every command (after output is printed).
// Shows an update notice if a newer version is cached.
// Also triggers a background refresh if cache is stale.
export function checkForUpdate(currentVersion) {
  const cache = readCache();
  const now = Date.now();

  // Trigger background refresh if cache is stale or missing.
  if (!cache || (now - (cache.checkedAt || 0)) > CACHE_TTL_MS) {
    refreshInBackground(currentVersion);
  }

  // Show notice if cache has a newer version.
  if (cache && isNewer(currentVersion, cache.latest)) {
    const divider = "─".repeat(56);
    process.stderr.write(
      `\n${divider}\n` +
      `  apx update available  ${currentVersion} → ${cache.latest}\n` +
      `  run: apx update\n` +
      `${divider}\n`
    );
  }
}

// Used by `apx update` command to get the latest version (with network call).
export async function getLatestVersion() {
  return await fetchLatest();
}
