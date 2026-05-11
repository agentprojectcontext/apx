// daemon/tools/fetch.js
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
