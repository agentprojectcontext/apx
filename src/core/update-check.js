// Update checker — non-blocking, cached 24h.
// On each command: reads cache → shows message if newer version exists.
// In background: refreshes cache from npm registry (fire-and-forget).
// Never slows down the main command.

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
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
  // The same declared seam `updateStatus` honours. It has to cover BOTH
  // surfaces or it only half exists: this notice fires off the CACHE, so
  // without it the only way to see the terminal banner is to actually be a
  // version behind — which is precisely the state you cannot arrange on
  // demand, and never the state of the machine doing the work.
  const fake = process.env.APX_UPDATE_SIMULATE;
  if (fake) {
    if (isNewer(currentVersion, fake)) notice(currentVersion, fake);
    return; // no background refresh: a simulation must not rewrite the cache
  }

  const cache = readCache();
  const now = Date.now();

  // Trigger background refresh if cache is stale or missing.
  if (!cache || (now - (cache.checkedAt || 0)) > CACHE_TTL_MS) {
    refreshInBackground(currentVersion);
  }

  // Show notice if cache has a newer version.
  if (cache && isNewer(currentVersion, cache.latest)) notice(currentVersion, cache.latest);
}

// Written to stderr, so piping a command's output somewhere never carries the
// banner into the pipe.
function notice(current, latest) {
  const divider = "─".repeat(56);
  process.stderr.write(
    `\n${divider}\n` +
    `  apx update available  ${current} → ${latest}\n` +
    `  run: apx update\n` +
    `${divider}\n`
  );
}

// Used by `apx update` command to get the latest version (with network call).
export async function getLatestVersion() {
  return await fetchLatest();
}

/**
 * The same answer the CLI banner gives, for anything that is not a terminal.
 *
 * One cache, one request a day, one verdict — so the panel and the CLI can
 * never disagree about whether there is an update, and the web surface costs
 * the registry nothing extra.
 *
 * `from_git` is the part that matters for a reader. In a clone, the installed
 * version is whatever the working tree says, npm's `latest` is behind it as
 * often as ahead, and `apx update` is the WRONG advice — that command replaces
 * a global npm install and has no business running against a checkout. So the
 * source is reported and the caller decides whether there is anything to say.
 */
export function updateStatus(currentVersion) {
  // A declared testing seam, and the only way to SEE this feature work.
  // Everywhere it can be developed, `from_git` is true and the banner is
  // deliberately silent — so without this the panel's update notice could only
  // ever be verified by shipping it and waiting for someone else's report.
  // Reported as `simulated` so nothing downstream can mistake it for real, and
  // logged, so a variable left set in a shell is noisy rather than quietly
  // lying to whoever opens the panel.
  const fake = process.env.APX_UPDATE_SIMULATE;
  if (fake) {
    console.warn(`apx: APX_UPDATE_SIMULATE=${fake} — reporting a fake update. Unset it to go back to the truth.`);
    return {
      current: currentVersion,
      latest: fake,
      newer: isNewer(currentVersion, fake),
      checked_at: Date.now(),
      from_git: false,
      simulated: true,
    };
  }

  const cache = readCache();
  const now = Date.now();
  if (!cache || (now - (cache.checkedAt || 0)) > CACHE_TTL_MS) {
    refreshInBackground(currentVersion);
  }
  const latest = cache?.latest || null;
  return {
    current: currentVersion,
    latest,
    newer: isNewer(currentVersion, latest),
    checked_at: cache?.checkedAt || null,
    from_git: isGitCheckout(),
  };
}

// The package root holds a .git directory only when APX is running from a
// clone. An npm install never does.
function isGitCheckout() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    return fs.existsSync(path.join(root, ".git"));
  } catch {
    return false;
  }
}
