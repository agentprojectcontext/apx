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
// Endpoints (mounted at /api/tools/browser by api.js):
//   POST /navigate          { url, launch_options?, allow_dangerous?, snapshot? }
//   POST /snapshot          { selector?, interactive_only?, max_nodes? }
//   POST /screenshot        { selector?, ref?, full_page?, width?, height?, encoded? }
//   POST /click             { selector | ref, snapshot? }
//   POST /type              { selector | ref, text, clear?, snapshot? }
//   POST /select            { selector | ref, value, snapshot? }
//   POST /hover             { selector | ref }
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
const MAX_SNAPSHOT_NODES   = 400;
const MAX_SNAPSHOT_CHARS   = 40 * 1024;

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
// Accessibility snapshot + refs
// ---------------------------------------------------------------------------
//
// Why this exists. A model driving Puppeteer by CSS selector has to invent the
// selector out of browser_get_content's raw HTML — a megabyte of markup to find
// one button, and a wrong guess most of the time. Snapshot walks the RENDERED
// DOM instead and returns what a screen reader would announce: role, accessible
// name, state, one line per element, with every control stamped `ref_N`. The
// action tools take `{ ref }`, so the model clicks what it read rather than
// what it inferred.
//
// Refs live in the page as `data-apx-ref` attributes and die with it. A
// navigation or a re-render invalidates them; the action tools then say so by
// name instead of failing on a mystery selector.

// Runs INSIDE the page — must stay self-contained (page.evaluate stringifies
// it, so it can close over nothing from this module).
function collectA11yNodes({ rootSelector, interactiveOnly, maxNodes }) {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "SVG", "PATH", "IFRAME"]);
  // Controls whose subtree the walk does not enter: their accessible name
  // already carries the inner text, so descending only duplicates it.
  const LEAF_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const INTERACTIVE_ROLES = new Set([
    "button", "link", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox",
    "menuitemradio", "option", "switch", "combobox", "textbox", "searchbox",
    "slider", "spinbutton", "treeitem",
  ]);
  const TAG_ROLES = {
    A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox",
    SUMMARY: "button", LABEL: "label", IMG: "img", FORM: "form", NAV: "navigation",
    MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    DIALOG: "dialog", TABLE: "table", TR: "row", ARTICLE: "article",
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  };
  // Emitted without a ref: they carry no action, they carry the grouping that
  // tells one "Delete" apart from the next.
  const LANDMARK_ROLES = new Set([
    "navigation", "main", "banner", "contentinfo", "complementary", "dialog",
    "form", "search", "region", "article", "table", "row", "tablist",
  ]);

  const nodes = [];
  let refSeq = 0;
  let truncated = false;

  // A fresh snapshot retires the previous generation of refs, so a stale ref
  // can never silently resolve to a different element after a re-render.
  for (const el of document.querySelectorAll("[data-apx-ref]")) el.removeAttribute("data-apx-ref");

  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return { error: `Element not found: ${rootSelector}` };

  const squash = (t, cap) => {
    const v = String(t || "").replace(/\s+/g, " ").trim();
    return v.length > cap ? v.slice(0, cap) + "…" : v;
  };

  function roleOf(el) {
    const explicit = (el.getAttribute("role") || "").trim().toLowerCase();
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    if (tag === "A") return el.hasAttribute("href") ? "link" : "";
    return TAG_ROLES[tag] || "";
  }

  function visible(el) {
    if (el.hasAttribute("hidden")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden") return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return !(cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0");
  }

  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return squash(aria, 120);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const joined = by.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => squash(n.innerText || n.textContent, 80))
        .join(" ");
      if (joined.trim()) return squash(joined, 120);
    }
    if (el.tagName === "IMG") return squash(el.getAttribute("alt"), 120);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      if (el.labels && el.labels.length) {
        const l = squash(el.labels[0].innerText || el.labels[0].textContent, 80);
        if (l) return l;
      }
      return squash(
        el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name"),
        120
      );
    }
    return squash(el.innerText || el.textContent, 120) || squash(el.getAttribute("title"), 120);
  }

  function isInteractive(el, role) {
    const tag = el.tagName;
    if (tag === "A") return el.hasAttribute("href");
    if (LEAF_TAGS.has(tag)) return true;
    if (el.isContentEditable) return true;
    if (INTERACTIVE_ROLES.has(role)) return true;
    const ti = el.getAttribute("tabindex");
    if (ti !== null && ti !== "-1") return true;
    return el.hasAttribute("onclick");
  }

  // Text owned by THIS element (its direct text-node children), so each run of
  // page copy is attributed to exactly one node and never repeated up the tree.
  function directText(el) {
    let out = "";
    for (const n of el.childNodes) if (n.nodeType === 3) out += n.nodeValue;
    return squash(out, 300);
  }

  function walk(el, depth, parentName) {
    if (nodes.length >= maxNodes) { truncated = true; return; }
    if (SKIP_TAGS.has(el.tagName)) return;
    if (!visible(el)) return;

    const role = roleOf(el);
    const interactive = isInteractive(el, role);
    let emitted = false;
    let ownName = parentName;

    if (interactive) {
      const ref = `ref_${++refSeq}`;
      el.setAttribute("data-apx-ref", ref);
      const name = nameOf(el);
      const node = { depth, ref, role: role || "generic", name };
      const type = el.tagName === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase() : null;
      if (type && type !== "text") node.type = type;
      if (el.tagName === "A") {
        const href = el.getAttribute("href");
        if (href) node.href = squash(href, 120);
      }
      // A password field's value is never worth echoing back into a transcript.
      const stateOnly = type === "checkbox" || type === "radio";
      if (!stateOnly && type !== "password" && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.value) {
        node.value = squash(el.value, 60);
      }
      if (el.tagName === "SELECT" && el.value) node.value = squash(el.value, 60);
      if (el.checked) node.checked = true;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") node.disabled = true;
      if (el.required) node.required = true;
      const expanded = el.getAttribute("aria-expanded");
      if (expanded !== null) node.expanded = expanded === "true";
      if (el.getAttribute("aria-selected") === "true") node.selected = true;
      nodes.push(node);
      emitted = true;
      ownName = name;
    } else if (!interactiveOnly && LANDMARK_ROLES.has(role)) {
      const label = squash(el.getAttribute("aria-label"), 80);
      nodes.push(label ? { depth, role, name: label } : { depth, role });
      emitted = true;
    } else if (!interactiveOnly && role === "heading") {
      const level = /^H[1-6]$/.test(el.tagName)
        ? Number(el.tagName[1])
        : Number(el.getAttribute("aria-level")) || null;
      const name = squash(el.innerText || el.textContent, 160);
      const node = { depth, role: "heading", name };
      if (level) node.level = level;
      nodes.push(node);
      emitted = true;
      ownName = name;
    }

    if (!interactiveOnly && !(el.tagName === "LABEL" && el.control)) {
      const own = directText(el);
      // Skip copy already spoken by the control that encloses it.
      if (own && own.length > 1 && own !== ownName && own !== parentName) {
        if (nodes.length >= maxNodes) truncated = true;
        else nodes.push({ depth: emitted ? depth + 1 : depth, role: "text", name: own });
      }
    }

    if (LEAF_TAGS.has(el.tagName)) return;
    const childDepth = emitted ? depth + 1 : depth;
    for (const child of el.children) walk(child, childDepth, ownName);
  }

  walk(root, 0, "");
  return { url: location.href, title: document.title, nodes, truncated };
}

/**
 * A structural node with no name and no children says nothing — layout tables
 * alone can emit dozens of them. Drop it: a node is empty when the next node is
 * not deeper than it is.
 */
export function pruneEmptyContainers(nodes) {
  const list = nodes || [];
  return list.filter((n, i) => {
    if (n.ref || n.name) return true;
    const next = list[i + 1];
    return !!next && (Number(next.depth) || 0) > (Number(n.depth) || 0);
  });
}

/** Render collected nodes as the indented, screen-reader-shaped text the model reads. */
export function renderSnapshot(nodes, { maxChars = MAX_SNAPSHOT_CHARS } = {}) {
  const lines = [];
  let chars = 0;
  let clipped = 0;
  for (const n of pruneEmptyContainers(nodes)) {
    const pad = "  ".repeat(Math.max(0, Math.min(Number(n.depth) || 0, 12)));
    let line = `${pad}- ${n.role || "generic"}`;
    if (n.name) line += ` ${JSON.stringify(n.name)}`;
    if (n.ref) line += ` [${n.ref}]`;
    const meta = [];
    if (n.level) meta.push(`level=${n.level}`);
    if (n.type) meta.push(`type=${n.type}`);
    if (n.href) meta.push(`href=${n.href}`);
    if (n.value) meta.push(`value=${JSON.stringify(n.value)}`);
    if (n.checked) meta.push("checked");
    if (n.selected) meta.push("selected");
    if (n.expanded !== undefined) meta.push(`expanded=${n.expanded}`);
    if (n.disabled) meta.push("disabled");
    if (n.required) meta.push("required");
    if (meta.length) line += ` {${meta.join(" ")}}`;
    if (chars + line.length + 1 > maxChars) { clipped++; continue; }
    chars += line.length + 1;
    lines.push(line);
  }
  if (clipped) lines.push(`…(${clipped} more nodes omitted — narrow with selector or interactive_only)`);
  return lines.join("\n");
}

/**
 * The CSS selector an action tool should act on, from either addressing mode.
 * `ref` wins when both are given; neither is an error the model can fix.
 */
export function resolveTarget({ ref, selector } = {}) {
  if (ref !== undefined && ref !== null && String(ref).trim() !== "") {
    const id = String(ref).trim();
    if (!/^ref_\d+$/.test(id)) {
      throw new Error(`invalid ref "${ref}" — refs look like "ref_12" and come from browser_snapshot`);
    }
    return `[data-apx-ref="${id}"]`;
  }
  if (selector !== undefined && selector !== null && String(selector).trim() !== "") {
    return String(selector);
  }
  return null;
}

function requireTarget({ ref, selector }) {
  const target = resolveTarget({ ref, selector });
  if (!target) throw new Error("ref or selector required — call browser_snapshot first and act on a ref");
  return target;
}

// Wait for the element, translating a missing ref into the one instruction
// that actually unblocks the model: take a new snapshot.
async function waitForTarget(page, target, ref, timeout = 10000) {
  try {
    await page.waitForSelector(target, { timeout });
  } catch (e) {
    if (ref) {
      throw new Error(
        `${ref} is no longer on the page — the DOM changed since the last browser_snapshot. ` +
        `Call browser_snapshot again and use a fresh ref.`
      );
    }
    throw e;
  }
}

// Actions accept `snapshot: true` to return the post-action page state in the
// same round trip, which is what keeps a multi-step flow from costing one extra
// tool call per click.
async function maybeSnapshot(want) {
  if (!want) return undefined;
  try {
    const s = await browser_snapshot();
    return s.snapshot;
  } catch {
    return undefined;
  }
}

export async function browser_snapshot({ selector, interactive_only = false, max_nodes } = {}) {
  return onPage(async (page) => {
    const cap = Math.min(Number(max_nodes) || MAX_SNAPSHOT_NODES, 1500);
    const res = await page.evaluate(collectA11yNodes, {
      rootSelector: selector ?? null,
      interactiveOnly: !!interactive_only,
      maxNodes: cap,
    });
    if (res?.error) throw new Error(res.error);
    const snapshot = renderSnapshot(res.nodes);
    return {
      ok: true,
      url: res.url,
      title: res.title,
      nodes: res.nodes.length,
      truncated: !!res.truncated,
      snapshot,
    };
  });
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function browser_navigate({ url, launch_options, allow_dangerous, wait_until, snapshot } = {}) {
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

  const snap = await maybeSnapshot(snapshot);
  return {
    ok: true,
    url: page.url(),
    status: response?.status() ?? null,
    title,
    wait_until: response ? (preferred) : null,
    ...(snap === undefined ? {} : { snapshot: snap }),
  };
}

export async function browser_screenshot({ selector, ref, full_page = false, width, height, encoded = false, save_path, save_to_tmp = false } = {}) {
  const target = resolveTarget({ ref, selector });
  const page = await ensureBrowser();
  if (width || height) {
    await page.setViewport({
      width: Math.min(width ?? 1280, 1920),
      height: Math.min(height ?? 800, 1080),
    });
  }

  const buf = await withContextRetry(async () => {
    const handle = target ? await page.$(target) : null;
    if (target && !handle) throw new Error(`Element not found: ${ref || selector}`);
    return handle
      ? await handle.screenshot({ type: "png", encoding: "base64" })
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

export async function browser_click({ selector, ref, snapshot } = {}) {
  const target = requireTarget({ ref, selector });
  const res = await onPage(async (page) => {
    await waitForTarget(page, target, ref);
    await page.click(target);
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    return { ok: true, ref: ref ?? null, selector: selector ?? null, url: page.url() };
  });
  const snap = await maybeSnapshot(snapshot);
  return snap === undefined ? res : { ...res, snapshot: snap };
}

export async function browser_type({ selector, ref, text, clear = true, snapshot } = {}) {
  const target = requireTarget({ ref, selector });
  if (text === undefined) throw new Error("text required");
  const res = await onPage(async (page) => {
    await waitForTarget(page, target, ref);
    await page.focus(target);
    if (clear) {
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
    }
    await page.type(target, String(text), { delay: 20 });
    return { ok: true, ref: ref ?? null, selector: selector ?? null, typed: String(text).length };
  });
  const snap = await maybeSnapshot(snapshot);
  return snap === undefined ? res : { ...res, snapshot: snap };
}

export async function browser_select({ selector, ref, value, snapshot } = {}) {
  const target = requireTarget({ ref, selector });
  if (value === undefined) throw new Error("value required");
  const res = await onPage(async (page) => {
    await waitForTarget(page, target, ref);
    await page.select(target, String(value));
    return { ok: true, ref: ref ?? null, selector: selector ?? null, value };
  });
  const snap = await maybeSnapshot(snapshot);
  return snap === undefined ? res : { ...res, snapshot: snap };
}

export async function browser_hover({ selector, ref } = {}) {
  const target = requireTarget({ ref, selector });
  return onPage(async (page) => {
    await waitForTarget(page, target, ref);
    await page.hover(target);
    return { ok: true, ref: ref ?? null, selector: selector ?? null };
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
  router.post("/snapshot",          wrap(browser_snapshot));
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
