// daemon/tools/browser.js
// Browser tools for APX — wraps Puppeteer as native APX tools.
// Puppeteer must be installed separately: npm install puppeteer
// Falls back to node-fetch for browser_fetch when Puppeteer is unavailable.
//
// Exposed endpoints (registered by api.js):
//   POST /tools/browser/navigate      { url }
//   POST /tools/browser/screenshot    {}
//   POST /tools/browser/click         { selector }
//   POST /tools/browser/type          { selector, text }
//   POST /tools/browser/fetch         { url, method?, headers?, body? }
//   POST /tools/browser/get_text      {}
//   POST /tools/browser/evaluate      { code }
//   POST /tools/browser/close         {}

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Shared Puppeteer browser state
// ---------------------------------------------------------------------------

let _browser = null;
let _page = null;
let _puppeteer = null;

async function loadPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try {
    // Try the ESM import path first, then CJS fallback
    const mod = await import("puppeteer").catch(() => null)
      || await import("puppeteer-core").catch(() => null);
    if (!mod) throw new Error("not found");
    _puppeteer = mod.default ?? mod;
    return _puppeteer;
  } catch {
    return null;
  }
}

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const pup = await loadPuppeteer();
  if (!pup) throw new Error("Puppeteer not installed. Run: npm install puppeteer");
  _browser = await pup.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  _browser.on("disconnected", () => { _browser = null; _page = null; });
  return _browser;
}

async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  const browser = await getBrowser();
  const pages = await browser.pages();
  _page = pages[0] || await browser.newPage();
  await _page.setViewport({ width: 1280, height: 800 });
  await _page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  return _page;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function browser_navigate({ url }) {
  if (!url) throw new Error("url required");
  const page = await getPage();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return {
    ok: true,
    url: page.url(),
    status: response?.status() ?? null,
    title: await page.title(),
  };
}

export async function browser_screenshot({ full_page = false } = {}) {
  const page = await getPage();
  const buf = await page.screenshot({ type: "png", fullPage: full_page, encoding: "base64" });
  return {
    ok: true,
    url: page.url(),
    format: "png",
    base64: buf,
  };
}

export async function browser_click({ selector }) {
  if (!selector) throw new Error("selector required");
  const page = await getPage();
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
  return { ok: true, selector, url: page.url() };
}

export async function browser_type({ selector, text, clear = true }) {
  if (!selector) throw new Error("selector required");
  if (text === undefined) throw new Error("text required");
  const page = await getPage();
  await page.waitForSelector(selector, { timeout: 10000 });
  if (clear) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
  }
  await page.type(selector, String(text), { delay: 20 });
  return { ok: true, selector, typed: String(text).length };
}

export async function browser_fetch({ url, method = "GET", headers = {}, body = null }) {
  if (!url) throw new Error("url required");

  // Try Puppeteer first (bypasses some blocks), fall back to node-fetch
  try {
    const page = await getPage();
    const result = await page.evaluate(
      async (u, m, h, b) => {
        const r = await fetch(u, {
          method: m,
          headers: h,
          body: b || undefined,
        });
        const text = await r.text();
        return { status: r.status, text };
      },
      url, method, headers, body
    );
    return { ok: result.status < 400, status: result.status, body: result.text, via: "puppeteer" };
  } catch {
    // Fallback to node-fetch
    const { default: fetch } = await import("node-fetch");
    const opts = { method, headers };
    if (body) opts.body = body;
    const r = await fetch(url, opts);
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: text, via: "node-fetch" };
  }
}

export async function browser_get_text() {
  const page = await getPage();
  const text = await page.evaluate(() => {
    // Remove scripts, styles, nav elements for cleaner output
    const clone = document.cloneNode(true);
    for (const tag of ["script", "style", "nav", "header", "footer", "noscript"]) {
      for (const el of clone.querySelectorAll(tag)) el.remove();
    }
    return clone.body?.innerText || clone.body?.textContent || "";
  });
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  return {
    ok: true,
    url: page.url(),
    title: await page.title(),
    text: cleaned,
    chars: cleaned.length,
  };
}

export async function browser_evaluate({ code }) {
  if (!code) throw new Error("code required");
  const page = await getPage();
  // eslint-disable-next-line no-new-func
  const result = await page.evaluate(new Function(code));
  return { ok: true, result };
}

export async function browser_close() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _page = null;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Puppeteer availability check (non-throwing)
// ---------------------------------------------------------------------------

export async function browserStatus() {
  const pup = await loadPuppeteer();
  return {
    puppeteer_available: !!pup,
    browser_open: !!(_browser && _browser.isConnected()),
    current_url: (_page && !_page.isClosed()) ? _page.url() : null,
  };
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildBrowserRouter(express) {
  const router = express.Router();

  function wrap(fn) {
    return async (req, res) => {
      try {
        const result = await fn(req.body || {});
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    };
  }

  router.post("/navigate",   wrap(browser_navigate));
  router.post("/screenshot", wrap(browser_screenshot));
  router.post("/click",      wrap(browser_click));
  router.post("/type",       wrap(browser_type));
  router.post("/fetch",      wrap(browser_fetch));
  router.post("/get_text",   wrap(browser_get_text));
  router.post("/evaluate",   wrap(browser_evaluate));
  router.post("/close",      wrap(browser_close));

  router.get("/status", async (_req, res) => {
    try {
      res.json(await browserStatus());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
