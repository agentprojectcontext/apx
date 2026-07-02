// Lightweight HTTP fetch tools — no Puppeteer, no Chromium. Starts in
// milliseconds. Use this when you only need to hit an HTTP endpoint
// (REST API, raw page HTML, JSON). For JS-rendered pages, real clicks,
// screenshots, etc., use tools/browser.js instead.
//
// Uses Node 18+ built-in fetch with a node-fetch fallback for older
// runtimes.
//
// Endpoints (mounted at /tools/fetch by api.js):
//   POST /get      { url, headers?, timeout_ms? }
//   POST /post     { url, body?, headers?, timeout_ms?, json? }
//   POST /request  { url, method?, headers?, body?, timeout_ms?, json? }

// ---------------------------------------------------------------------------
// Fetch resolver
// ---------------------------------------------------------------------------

import dns from "node:dns/promises";
import net from "node:net";

let _fetch = null;

async function getFetch() {
  if (_fetch) return _fetch;
  if (typeof globalThis.fetch === "function") {
    _fetch = globalThis.fetch.bind(globalThis);
    return _fetch;
  }
  const mod = await import("node-fetch").catch(() => null);
  if (!mod) throw new Error("No fetch available. Upgrade Node to >=18 or install node-fetch.");
  _fetch = mod.default;
  return _fetch;
}

const DEFAULT_TIMEOUT = 30000;
const MAX_BODY_BYTES  = 5 * 1024 * 1024; // 5MB

// Block cloud metadata endpoints by name (they may resolve to public-looking
// IPs on some providers). IP-range blocking is done on the RESOLVED address
// below, not on the literal host string.
const BLOCKED_HOST_RE = /^(metadata\.google\.internal\.?|metadata\.goog\.?)$/i;

// True for an IPv4 string in a loopback / private / link-local / CGNAT range.
// Malformed input returns true (fail closed) — validateUrl only feeds this
// addresses from dns.lookup / net.isIP, so a non-parse means "don't trust it".
function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;                 // this-host / loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
  return false;
}

function isBlockedAddress(addr) {
  if (!addr) return true;
  const ip = String(addr).toLowerCase();
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped IPv6
  if (mapped) return isPrivateIpv4(mapped[1]);
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIpv4(ip);
  if (fam === 6) {
    if (ip === "::1" || ip === "::") return true;                // loopback / unspecified
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(ip)) return true;                       // link-local fe80::/10
    return false;
  }
  return true; // not a recognizable IP → fail closed
}

// SSRF guard. Resolving the host to concrete IPs (rather than pattern-matching
// the literal string) defeats DNS names that point at internal ranges AND
// numeric encodings like http://2130706433 (= 127.0.0.1) that a regex misses.
// Residual: a rebind between this lookup and the actual connect is still
// theoretically possible; pinning the resolved IP would need a custom agent.
async function validateUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Protocol "${parsed.protocol}" is not allowed; use http or https`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST_RE.test(host)) {
    throw new Error(`Requests to private or link-local addresses are blocked`);
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve host");
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error(`Requests to private or link-local addresses are blocked`);
  }
}

async function readBody(response, jsonHint) {
  const ctype = response.headers.get("content-type") || "";
  const wantsJson = jsonHint || ctype.includes("application/json");

  // Use arrayBuffer so we can enforce a size cap regardless of content-type.
  const ab = await response.arrayBuffer();
  if (ab.byteLength > MAX_BODY_BYTES) {
    return {
      truncated: true,
      bytes: ab.byteLength,
      text: Buffer.from(ab.slice(0, MAX_BODY_BYTES)).toString("utf8") + "\n[TRUNCATED]",
      json: null,
    };
  }
  const text = Buffer.from(ab).toString("utf8");
  let json = null;
  if (wantsJson) {
    try { json = JSON.parse(text); } catch { /* not JSON; leave as text */ }
  }
  return { truncated: false, bytes: ab.byteLength, text, json };
}

async function doRequest({ url, method = "GET", headers = {}, body = null, timeout_ms = DEFAULT_TIMEOUT, json = false } = {}) {
  if (!url) throw new Error("url required");
  await validateUrl(url);
  const fetch = await getFetch();

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout_ms);

  const opts = {
    method: String(method).toUpperCase(),
    headers: { ...headers },
    signal: controller.signal,
  };

  if (body !== null && body !== undefined && opts.method !== "GET" && opts.method !== "HEAD") {
    if (typeof body === "object" && !(body instanceof Uint8Array) && !(typeof Buffer !== "undefined" && Buffer.isBuffer?.(body))) {
      opts.body = JSON.stringify(body);
      if (!opts.headers["content-type"] && !opts.headers["Content-Type"]) {
        opts.headers["content-type"] = "application/json";
      }
    } else {
      opts.body = body;
    }
  }

  try {
    const r = await fetch(url, opts);
    const parsed = await readBody(r, json);
    const responseHeaders = {};
    r.headers.forEach((v, k) => { responseHeaders[k] = v; });
    return {
      ok: r.ok,
      status: r.status,
      status_text: r.statusText,
      url: r.url,
      headers: responseHeaders,
      bytes: parsed.bytes,
      truncated: parsed.truncated,
      body: parsed.text,
      json: parsed.json,
    };
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Request timeout after ${timeout_ms}ms`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function http_get({ url, headers, timeout_ms } = {}) {
  return doRequest({ url, method: "GET", headers, timeout_ms });
}

export async function http_post({ url, body, headers, timeout_ms, json } = {}) {
  return doRequest({ url, method: "POST", headers, body, timeout_ms, json });
}

export async function http_request(params = {}) {
  return doRequest(params);
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildFetchRouter(express) {
  const router = express.Router();
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req.body || {})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  };

  router.post("/get",     wrap(http_get));
  router.post("/post",    wrap(http_post));
  router.post("/request", wrap(http_request));

  return router;
}
