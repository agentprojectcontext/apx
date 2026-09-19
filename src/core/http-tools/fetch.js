// Lightweight HTTP fetch tools — no Puppeteer, no Chromium. Starts in
// milliseconds. Use this when you only need to hit an HTTP endpoint
// (REST API, raw page HTML, JSON). For JS-rendered pages, real clicks,
// screenshots, etc., use tools/browser.js instead.
//
// Uses Node 18+ built-in fetch with a node-fetch fallback for older
// runtimes.
//
// Endpoints (mounted at /api/tools/fetch by api.js):
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
const MAX_BODY_BYTES  = 5 * 1024 * 1024; // 5MB — what we are willing to download

// What we are willing to hand BACK. A different question, and the one that
// matters: this body is about to become part of a model's context. 5 MB of HTML
// is over a million tokens, which is not a big response — it is a dead turn.
const MAX_TEXT_BYTES  = 256 * 1024;

// Media types that ARE text. Everything else is bytes, and bytes do not get
// decoded — see readBody.
const TEXTUAL_TYPE_RE = /^text\/|^application\/(json|xml|javascript|ecmascript|x-ndjson|x-www-form-urlencoded|xhtml\+xml|graphql)|\+(json|xml)\b/i;

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

/**
 * Turn a response into something safe to put in front of a model.
 *
 * This used to decode ANY content-type as UTF-8 and hand back up to 5 MB of it.
 * On 2026-09-18 an agent called http_get on a 3.8 MB .mp4 to check that a video
 * was online. The bytes came back as 3.665.297 characters, 43% of them U+FFFD
 * replacement chars, and the turn died at 4.336.896 tokens against a 1.048.576
 * limit — having answered nothing. A HEAD request would have told it everything
 * it actually wanted to know.
 *
 * So: bytes are not text, and are never pretended to be. A binary response comes
 * back described (type, size, reachable) rather than decoded, which is the whole
 * of what a caller can use anyway. Text comes back capped at something a context
 * window can hold — and how much we are willing to pull off the socket at all is
 * a separate ceiling, enforced one level down in readCapped.
 */
async function readBody(response, jsonHint) {
  const ctype = response.headers.get("content-type") || "";
  const body = response.body;
  const { buf, capped } = typeof body?.[Symbol.asyncIterator] === "function"
    ? await readCapped(body)
    // Nothing to stop pulling (204, HEAD, a fetch impl that exposes no stream):
    // read it whole. The decision below is made on real bytes either way.
    : { buf: Buffer.from(await response.arrayBuffer()), capped: false };
  return decodeBody(buf, ctype, { jsonHint, downloadCapped: capped });
}

/**
 * Drain a response stream, stopping at the download cap.
 *
 * MAX_TEXT_BYTES governs what leaves this module; this governs what enters it.
 * Two questions, and for a while only one of them was answered: `arrayBuffer()`
 * buffers the WHOLE body before any cap can look at it, so the 5 MB ceiling was
 * a comment rather than a limit and a 500 MB response was 500 MB of daemon
 * memory on its way to a 256 KB answer.
 *
 * Breaking out of the loop closes the async iterator, which cancels the
 * underlying stream — the rest of the file is never pulled over the socket.
 *
 * Exported for the same reason decodeBody is: http_get refuses loopback
 * addresses (SSRF guard), so there is no local server to point it at.
 */
export async function readCapped(stream, cap = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const b = Buffer.from(chunk);
    if (total + b.byteLength > cap) {
      chunks.push(b.subarray(0, cap - total));
      return { buf: Buffer.concat(chunks), capped: true };
    }
    chunks.push(b);
    total += b.byteLength;
  }
  return { buf: Buffer.concat(chunks), capped: false };
}

/** The decision itself, with no socket attached — which is what makes it
 *  testable: http_get refuses loopback addresses (SSRF guard), so there is no
 *  local server to point it at. */
export function decodeBody(buf, ctype = "", { jsonHint = false, downloadCapped = false } = {}) {
  const wantsJson = jsonHint || ctype.includes("application/json");
  // When the download was cut at MAX_BODY_BYTES, what we hold is a floor on the
  // real size, not the size. Say "at least" rather than report a number we know
  // is wrong — content-length, when the server sent one, is in the headers.
  const size = downloadCapped ? `at least ${buf.byteLength}` : `${buf.byteLength}`;

  // A NUL in the first kilobyte means bytes, whatever the content-type says —
  // and a server that sends no content-type at all is exactly where that
  // matters. Text does not contain NUL.
  const looksBinary = buf.subarray(0, 1024).includes(0);
  const declaredText = TEXTUAL_TYPE_RE.test(ctype);
  const isText = ctype ? declaredText && !looksBinary : !looksBinary;

  if (!isText) {
    const kind = ctype.split(";")[0].trim() || "application/octet-stream";
    return {
      binary: true,
      truncated: downloadCapped,
      bytes: buf.byteLength,
      media_type: kind,
      // Deliberately a sentence and not the file: it says everything a caller
      // can act on. To fetch the bytes themselves, download them to disk —
      // a tool result is not a place to put a video.
      text: `[${kind}, ${size} bytes — not decoded: this is a binary body, ` +
            `not text. The request succeeded, which is what a reachability check asks. ` +
            `To work with the file, download it to disk instead of reading it here.]`,
      json: null,
    };
  }

  const overCap = buf.byteLength > MAX_TEXT_BYTES;
  const text = overCap
    ? buf.subarray(0, MAX_TEXT_BYTES).toString("utf8") +
      `\n[TRUNCATED — ${size} bytes, showing the first ${MAX_TEXT_BYTES}]`
    : buf.toString("utf8");

  let json = null;
  // Parsing a truncated document is parsing a document that ended mid-sentence.
  if (wantsJson && !overCap) {
    try { json = JSON.parse(text); } catch { /* not JSON; leave as text */ }
  }
  return { binary: false, truncated: overCap, bytes: buf.byteLength, text, json };
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
      ...(parsed.binary ? { binary: true, media_type: parsed.media_type } : {}),
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
