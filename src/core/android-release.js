// What the published Android APK is, and where to get it.
//
// APX is not on Play, so a GitHub release IS the distribution and there is no
// store to tell a phone it is out of date. This is the replacement: one place
// that knows what `android-latest` currently points at, cached, shared by
// everything that needs to compare a version against it — `apx android status`
// over the cable, and `GET /api/android/latest`, which is how the phone itself
// asks.
//
// THE PHONE ASKS THE DAEMON, NOT GITHUB. Not because it could not, but because
// the daemon is the only thing the app ever talks to: one cache instead of one
// per phone, one machine against GitHub's unauthenticated rate limit, and a
// single place to later pin a version if a build ever has to be held back.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "./config/index.js";

/** The pointer tag. Rewritten in place on every build — see the workflow. */
export const ANDROID_TAG = "android-latest";

/** Where the published APK lives. A pointer tag, so this link never moves. */
export const APK_URL =
  `https://github.com/agentprojectcontext/apx/releases/download/${ANDROID_TAG}/apx.apk`;

const RELEASE_API =
  `https://api.github.com/repos/agentprojectcontext/apx/releases/tags/${ANDROID_TAG}`;

const CACHE_PATH = path.join(APX_HOME, "android-release.json");

/**
 * One hour, not the update checker's 24.
 *
 * A phone asks this when someone opens the menu wondering whether to update,
 * which is exactly the moment a day-old answer is wrong. An hour still means
 * GitHub sees at most 24 requests a day from this machine however many phones
 * are paired to it.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data) + "\n");
  } catch {
    // A cache that cannot be written is a slower check, not a failure.
  }
}

/**
 * Compare two `a.b.c` strings. True when `latest` is genuinely newer.
 *
 * Deliberately NOT the versionCode: that is a build date, it moves on every
 * rebuild of the same version, and comparing on it would offer an "update"
 * that changes nothing. The code exists so Android accepts the install; the
 * name is what a person is being told about.
 */
export function isNewerVersion(current, latest) {
  // Padded to three. "0.3" is 0.3.0 and "" is 0.0.0 — without this the missing
  // positions come back `undefined`, and every comparison against one is false,
  // so a phone on a short version string is told it is current forever.
  const parse = (v) => {
    const parts = String(v || "").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };
  const [ma, mi, pa] = parse(current);
  const [mb, mib, pb] = parse(latest);
  if (!mb && !mib && !pb) return false;
  if (mb !== ma) return mb > ma;
  if (mib !== mi) return mib > mi;
  return pb > pa;
}

/**
 * Pull the facts out of a GitHub release.
 *
 * Two readings, in order. The workflow publishes `apx-android.json` next to the
 * APK and that is the answer when it is there; every release made before it did
 * has the same facts written into its title and notes, so those are parsed as a
 * fallback rather than leaving a phone unable to check until the next build.
 */
function factsFrom(release, jsonAsset) {
  if (jsonAsset && typeof jsonAsset === "object") {
    const { version, version_code, sha256, size } = jsonAsset;
    if (version) {
      return {
        version: String(version),
        version_code: Number(version_code) || null,
        sha256: sha256 ? String(sha256) : null,
        size: Number(size) || null,
      };
    }
  }
  const body = String(release?.body || "");
  const apk = (release?.assets || []).find((a) => a?.name === "apx.apk");
  return {
    // The release title is "APX Android <version>" — see the workflow.
    version: /APX Android\s+(\S+)/.exec(release?.name || "")?.[1] || null,
    version_code: Number(/versionCode\s+(\d+)/.exec(body)?.[1]) || null,
    sha256: /\b([0-9a-f]{64})\b/.exec(body)?.[1] || null,
    size: Number(apk?.size) || null,
  };
}

async function getJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: {
      accept: "application/vnd.github+json",
      // GitHub rejects an API request with no User-Agent outright.
      "user-agent": "apx-daemon",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * The published APK, or null when GitHub cannot be reached.
 *
 * Null is an honest answer and the callers treat it as one: "I do not know"
 * must never render as "you are up to date", because the phone that most needs
 * telling is the one whose owner is not looking.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force]  ignore the cache (the owner pressed "check").
 * @param {number}  [opts.timeoutMs]
 */
export async function publishedApk({ force = false, timeoutMs = 6000 } = {}) {
  const cached = readCache();
  if (!force && cached?.version && Date.now() - (cached.checked_at || 0) < CACHE_TTL_MS) {
    return cached;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const release = await getJson(RELEASE_API, ctrl.signal);
    if (!release) return cached || null;

    let sidecar = null;
    const asset = (release.assets || []).find((a) => a?.name === "apx-android.json");
    if (asset?.browser_download_url) {
      try {
        sidecar = await getJson(asset.browser_download_url, ctrl.signal);
      } catch {
        // Fall through to the notes. A missing sidecar is the normal state of
        // every release published before it existed.
      }
    }

    const facts = factsFrom(release, sidecar);
    if (!facts.version) return cached || null;

    const out = { ...facts, url: APK_URL, checked_at: Date.now() };
    writeCache(out);
    return out;
  } catch {
    // A stale answer beats no answer: the version it names really was
    // published, it is only possibly not the newest one.
    return cached || null;
  } finally {
    clearTimeout(timer);
  }
}
