// Puppeteer-backed browser automation tools for APX.
//
// Logic adapted from the puppeteer-server MCP server
// (github.com/tecnomanu/puppeteer-server) — ensureBrowser with security args,
// docker/npx detection, in-page console capture during evaluate, screenshot
// with selector + size limits, deep-merge of launch options.
//
// Puppeteer is loaded lazily — the headless Chromium is only spawned when a
// browser_* tool is actually called. HTTP-only fetching lives in fetch.js
// (no Chromium needed).
//
// Endpoints (mounted at /tools/browser by api.js):
//   POST /navigate          { url, launch_options?, allow_dangerous? }
//   POST /screenshot        { selector?, full_page?, width?, height?, encoded? }
//   POST /click             { selector }
//   POST /type              { selector, text, clear? }
//   POST /select            { selector, value }
//   POST /hover             { selector }
//   POST /evaluate          { code }
//   POST /get_text          { selector? }
//   POST /get_content       { selector? }   // raw innerHTML
//   POST /wait_for_selector { selector, timeout? }
//   POST /close             {}
//   GET  /status

// ---------------------------------------------------------------------------
// Shared Puppeteer state
// ---------------------------------------------------------------------------

let _browser = null;
let _page = null;
let _puppeteer = null;
let _previousLaunchOptions = null;
const _consoleLogs = [];

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_CONTENT_CHARS    = 1 * 1024 * 1024; // 1MB

// Args we always pass for stability + reduced attack surface.
const SECURITY_ARGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-plugins",
  "--disable-sync",
  "--disable-translate",
  "--disable-background-networking",
  "--disable-component-extensions-with-background-pages",
];

// Args that reduce security — only allowed when allow_dangerous=true or
// ALLOW_DANGEROUS=true in env (kept for Docker / CI).
const DANGEROUS_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--single-process",
  "--disable-web-security",
  "--ignore-certificate-errors",
  "--disable-features=IsolateOrigins",
  "--disable-site-isolation-trials",
  "--allow-running-insecure-content",
  "--disable-dev-shm-usage",
  "--remote-debugging-port",
  "--remote-debugging-address",
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  if (typeof target !== "object" || target === null) return source;
  if (typeof source !== "object" || source === null) return source;

  const out = { ...target };
  for (const key of Object.keys(source)) {
    const t = target[key];
    const s = source[key];
    if (Array.isArray(t) && Array.isArray(s)) {
      // For args/ignoreDefaultArgs: dedupe by flag prefix, prefer source.
      if (key === "args" || key === "ignoreDefaultArgs") {
        const sourcePrefixes = new Set(s.map(a => String(a).split("=")[0]));
        const kept = t.filter(a => !(String(a).startsWith("--") && sourcePrefixes.has(String(a).split("=")[0])));
        out[key] = [...new Set([...kept, ...s])];
      } else {
        out[key] = [...new Set([...t, ...s])];
      }
    } else if (s && typeof s === "object" && !Array.isArray(s) && key in target) {
      out[key] = deepMerge(t, s);
    } else {
      out[key] = s;
    }
  }
  return out;
}

async function loadPuppeteer() {
  if (_puppeteer) return _puppeteer;
  const mod =
    (await import("puppeteer").catch(() => null)) ||
    (await import("puppeteer-core").catch(() => null));
  if (!mod) return null;
  _puppeteer = mod.default ?? mod;
  return _puppeteer;
}

function checkDangerous(args, allowDangerous) {
  if (!Array.isArray(args)) return;
  const found = args.filter(a => DANGEROUS_ARGS.some(d => String(a).startsWith(d)));
  if (found.length && !allowDangerous && process.env.ALLOW_DANGEROUS !== "true") {
    throw new Error(
      `Dangerous browser args detected: ${found.join(", ")}. ` +
      `Pass allow_dangerous=true or set ALLOW_DANGEROUS=true to override.`
    );
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

async function ensureBrowser({ launch_options, allow_dangerous } = {}) {
  const pup = await loadPuppeteer();
  if (!pup) throw new Error("Puppeteer not installed. Run: npm install puppeteer");

  let envOptions = {};
  try {
    envOptions = JSON.parse(process.env.PUPPETEER_LAUNCH_OPTIONS || "{}");
  } catch (e) {
    console.warn("[browser] could not parse PUPPETEER_LAUNCH_OPTIONS:", e.message);
  }

  const merged = deepMerge(envOptions, launch_options || {});
  if (merged?.args) checkDangerous(merged.args, allow_dangerous);

  // If launch options changed, recycle the browser.
  const optsChanged = launch_options && JSON.stringify(launch_options) !== JSON.stringify(_previousLaunchOptions);
  if (_browser && (!_browser.connected || optsChanged)) {
    await _browser.close().catch(() => {});
    _browser = null;
    _page = null;
  }
  _previousLaunchOptions = launch_options ?? _previousLaunchOptions;

  if (_browser && _browser.connected) {
    return _page && !_page.isClosed() ? _page : (_page = (await _browser.pages())[0] || await _browser.newPage());
  }

  const baseSecure = [...SECURITY_ARGS, "--disable-gpu", "--no-zygote"];
  const npxConfig = {
    headless: "new",
    args: baseSecure,
    defaultViewport: { width: 1280, height: 800 },
  };
  const dockerConfig = {
    headless: "new",
    args: [...baseSecure, "--no-sandbox", "--single-process", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 800 },
  };
  const baseConfig = process.env.DOCKER_CONTAINER ? dockerConfig : npxConfig;
  const finalConfig = deepMerge(baseConfig, merged);

  _browser = await pup.launch(finalConfig);
  _browser.on("disconnected", () => { _browser = null; _page = null; });

  const pages = await _browser.pages();
  _page = pages[0] || await _browser.newPage();
  await _page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Capture page console output to a ring buffer.
  _page.on("console", msg => {
    const entry = `[${msg.type()}] ${msg.text()}`;
    _consoleLogs.push(entry);
    if (_consoleLogs.length > 500) _consoleLogs.splice(0, _consoleLogs.length - 500);
  });

  return _page;
}

// ---------------------------------------------------------------------------
// Context-destruction resilience
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Puppeteer throws this family of errors when an action (evaluate / get_text /
// click / …) runs while the page is navigating, redirecting, or reloading —
// the frame's JS execution context is torn down mid-call. Redirect-heavy sites
// (ESPN geo/consent hops, login walls) trigger it constantly. These are
// transient: waiting for the navigation to settle and retrying succeeds.
const CONTEXT_DESTROYED_RE =
  /Execution context was destroyed|Cannot find context|Execution context is not available|detached frame|frame (?:was|got) detached|Target closed|Session closed|Protocol error.*(?:Runtime|Page)\./i;

export function isContextDestroyed(err) {
  return CONTEXT_DESTROYED_RE.test(String(err?.message || err));
}

// Let any in-flight navigation finish so the next action sees a stable context.
async function settlePage(page, { timeout = 5000 } = {}) {
  if (!page || page.isClosed()) return;
  await page.waitForNetworkIdle({ idleTime: 500, timeout }).catch(() => {});
}

// Run a page action, retrying on a transient "Execution context was destroyed"
// (and friends): wait `delayMs`, let the page settle, try again — up to
// `retries` extra attempts. Non-context errors bubble immediately.
export async function withContextRetry(fn, { retries = 2, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isContextDestroyed(e) || attempt === retries) throw e;
      await sleep(delayMs);
      await settlePage(_page);
    }
  }
  throw lastErr;
}

// Convenience: ensure the browser/page, then run an action under context-retry.
async function onPage(fn) {
  const page = await ensureBrowser();
  return withContextRetry(() => fn(page));
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function browser_navigate({ url, launch_options, allow_dangerous, wait_until } = {}) {
  if (!url) throw new Error("url required");
  const page = await ensureBrowser({ launch_options, allow_dangerous });

  const go = async (waitUntil) => {
    const response = await page.goto(url, { waitUntil, timeout: 30000 });
    // Some sites fire a client-side redirect/reload right after the initial
    // load. Give it a beat to settle so the execution context is stable for
    // the caller's NEXT tool (get_text/evaluate) instead of being destroyed
    // out from under it.
    await settlePage(page, { timeout: 3000 });
    return response;
  };

  // Preferred wait strategy: networkidle2 (or caller override). On a
  // context-destroyed / timeout / navigation error, fall back to the much more
  // permissive "domcontentloaded" which resolves as soon as the DOM is parsed,
  // before late redirects/XHR can tear the context down.
  const preferred = wait_until || "networkidle2";
  let response;
  try {
    response = await go(preferred);
  } catch (e) {
    const recoverable =
      isContextDestroyed(e) ||
      /TimeoutError|Navigation timeout|net::ERR_ABORTED|frame was detached/i.test(String(e?.message || e));
    if (!recoverable || preferred === "domcontentloaded") throw e;
    await sleep(1500);
    response = await go("domcontentloaded");
  }

  // title() evaluates in-page, so it can itself throw if a redirect is still
  // in flight — read it defensively (url() is sync and always safe).
  let title = "";
  try {
    title = await withContextRetry(() => page.title(), { retries: 1, delayMs: 1000 });
  } catch {
    title = "";
  }

  return {
    ok: true,
    url: page.url(),
    status: response?.status() ?? null,
    title,
    wait_until: response ? (preferred) : null,
  };
}

export async function browser_screenshot({ selector, full_page = false, width, height, encoded = false, save_path, save_to_tmp = false } = {}) {
  const page = await ensureBrowser();
  if (width || height) {
    await page.setViewport({
      width: Math.min(width ?? 1280, 1920),
      height: Math.min(height ?? 800, 1080),
    });
  }

  const buf = await withContextRetry(async () => {
    const target = selector ? await page.$(selector) : null;
    if (selector && !target) throw new Error(`Element not found: ${selector}`);
    return target
      ? await target.screenshot({ type: "png", encoding: "base64" })
      : await page.screenshot({ type: "png", encoding: "base64", fullPage: !!full_page });
  });

  const size = Buffer.from(String(buf), "base64").length;
  if (size > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot too large: ${Math.round(size / 1024)}KB (max ${Math.round(MAX_SCREENSHOT_BYTES / 1024)}KB)`);
  }

  // Optional disk write so the caller can pass `path` to e.g. send_telegram
  // instead of shuttling base64 around.
  let writtenPath = null;
  if (save_path || save_to_tmp) {
    const fs   = await import("node:fs");
    const path = await import("node:path");
    const os   = await import("node:os");
    let target = save_path;
    if (!target) {
      const dir = path.join(os.tmpdir(), "apx-screenshots");
      fs.mkdirSync(dir, { recursive: true });
      target = path.join(dir, `screenshot-${Date.now()}.png`);
    }
    fs.writeFileSync(target, Buffer.from(String(buf), "base64"));
    writtenPath = target;
  }

  return {
    ok: true,
    url: page.url(),
    format: "png",
    bytes: size,
    base64: buf,
    path: writtenPath,
    data_uri: encoded ? `data:image/png;base64,${buf}` : undefined,
  };
}

export async function browser_click({ selector } = {}) {
  if (!selector) throw new Error("selector required");
  return onPage(async (page) => {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    return { ok: true, selector, url: page.url() };
  });
}

export async function browser_type({ selector, text, clear = true } = {}) {
  if (!selector) throw new Error("selector required");
  if (text === undefined) throw new Error("text required");
  return onPage(async (page) => {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.focus(selector);
    if (clear) {
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
    }
    await page.type(selector, String(text), { delay: 20 });
    return { ok: true, selector, typed: String(text).length };
  });
}

export async function browser_select({ selector, value } = {}) {
  if (!selector) throw new Error("selector required");
  if (value === undefined) throw new Error("value required");
  return onPage(async (page) => {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.select(selector, String(value));
    return { ok: true, selector, value };
  });
}

export async function browser_hover({ selector } = {}) {
  if (!selector) throw new Error("selector required");
  return onPage(async (page) => {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.hover(selector);
    return { ok: true, selector };
  });
}

export async function browser_evaluate({ code } = {}) {
  if (!code) throw new Error("code required");
  return onPage((page) => evaluateOnPage(page, code));
}

async function evaluateOnPage(page, code) {
  // Install in-page console capture so evaluated code's logs come back.
  await page.evaluate(() => {
    window.__apxHelper = { logs: [], orig: { ...console } };
    for (const m of ["log", "info", "warn", "error", "debug"]) {
      console[m] = (...a) => {
        window.__apxHelper.logs.push(`[${m}] ${a.map(x => {
          try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); }
        }).join(" ")}`);
        window.__apxHelper.orig[m](...a);
      };
    }
  });

  let result, error;
  try {
    // eslint-disable-next-line no-new-func
    result = await page.evaluate(new Function(code));
  } catch (e) {
    error = e.message;
  }

  const logs = await page.evaluate(() => {
    Object.assign(console, window.__apxHelper.orig);
    const out = window.__apxHelper.logs;
    delete window.__apxHelper;
    return out;
  });

  if (error) throw new Error(`evaluate failed: ${error}\nlogs:\n${logs.join("\n")}`);
  return { ok: true, result, logs };
}

export async function browser_get_text({ selector } = {}) {
  return onPage(async (page) => {
    const text = await page.evaluate((sel) => {
      const root = sel ? document.querySelector(sel) : document.body;
      if (!root) return null;
      const clone = root.cloneNode(true);
      for (const tag of ["script", "style", "nav", "header", "footer", "noscript"]) {
        for (const el of clone.querySelectorAll(tag)) el.remove();
      }
      return clone.innerText || clone.textContent || "";
    }, selector ?? null);
    if (text === null) throw new Error(`Element not found: ${selector}`);
    const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
    let title = "";
    try { title = await page.title(); } catch { title = ""; }
    return {
      ok: true,
      url: page.url(),
      title,
      text: cleaned,
      chars: cleaned.length,
    };
  });
}

export async function browser_get_content({ selector } = {}) {
  return onPage(async (page) => {
    let content = selector
      ? await page.$eval(selector, el => el.innerHTML).catch(() => null)
      : await page.content();
    if (content === null) throw new Error(`Element not found: ${selector}`);

    let truncated = false;
    if (content.length > MAX_CONTENT_CHARS) {
      content = content.slice(0, MAX_CONTENT_CHARS) + "\n[TRUNCATED]";
      truncated = true;
    }
    return {
      ok: true,
      url: page.url(),
      selector: selector ?? null,
      chars: content.length,
      truncated,
      html: content,
    };
  });
}

export async function browser_wait_for_selector({ selector, timeout = 30000 } = {}) {
  if (!selector) throw new Error("selector required");
  return onPage((page) => page.waitForSelector(selector, { timeout }).then(() => ({ ok: true, selector })));
}

export async function browser_close() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _page = null;
    _consoleLogs.length = 0;
  }
  return { ok: true };
}

export async function browserStatus() {
  const pup = await loadPuppeteer();
  return {
    puppeteer_available: !!pup,
    browser_open: !!(_browser && _browser.connected),
    current_url: (_page && !_page.isClosed()) ? _page.url() : null,
    console_log_count: _consoleLogs.length,
  };
}

export function getConsoleLogs(limit = 100) {
  return _consoleLogs.slice(-limit);
}

// Graceful shutdown — best-effort close on process exit.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (_browser) await _browser.close().catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildBrowserRouter(express) {
  const router = express.Router();
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req.body || {})); }
    catch (e) { res.status(500).json({ error: e.message }); }
  };

  router.post("/navigate",          wrap(browser_navigate));
  router.post("/screenshot",        wrap(browser_screenshot));
  router.post("/click",             wrap(browser_click));
  router.post("/type",              wrap(browser_type));
  router.post("/select",            wrap(browser_select));
  router.post("/hover",             wrap(browser_hover));
  router.post("/evaluate",          wrap(browser_evaluate));
  router.post("/get_text",          wrap(browser_get_text));
  router.post("/get_content",       wrap(browser_get_content));
  router.post("/wait_for_selector", wrap(browser_wait_for_selector));
  router.post("/close",             wrap(browser_close));

  router.get("/status", async (_req, res) => {
    try { res.json(await browserStatus()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get("/console_logs", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ ok: true, logs: getConsoleLogs(limit) });
  });

  return router;
}
