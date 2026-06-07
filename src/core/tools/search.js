// daemon/tools/search.js
// WebSearch tool for APX — 3 modes:
//   1. DuckDuckGo HTML scraping (no API key, uses node-fetch)
//   2. Brave Search API (requires BRAVE_API_KEY env)
//   3. Puppeteer Google fallback (requires puppeteer installed)
//
// Endpoint: POST /tools/search
// Body: { query, mode: "auto"|"ddg"|"brave"|"browser", limit? }

import { browser_navigate, browser_get_text, browser_evaluate } from "./browser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fetch agent that uses the system proxy when HTTPS_PROXY / https_proxy is set */
async function buildAgent(url) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return undefined;
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const { HttpProxyAgent } = await import("http-proxy-agent");
    return url.startsWith("https") ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl);
  } catch {
    return undefined;
  }
}

async function nodeFetch(url, opts = {}) {
  const { default: fetch } = await import("node-fetch");
  if (!opts.agent) {
    const agent = await buildAgent(url);
    if (agent) opts = { ...opts, agent };
  }
  return fetch(url, opts);
}

/** Very small regex-based HTML text extractor (avoids full parse5 dependency) */
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Generic numeric entities (decimal &#92; and hex &#x27;) DDG sprinkles into
    // titles/snippets — decode so results read cleanly.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Unwrap DuckDuckGo's result redirect. DDG no longer exposes the target URL
 * directly: every result href is `//duckduckgo.com/l/?uddg=<urlencoded real
 * url>&rut=...`. We pull the `uddg` param out and decode it back to the real
 * destination. Plain/protocol-relative URLs are normalized to https.
 */
export function unwrapDdgUrl(href) {
  if (!href) return href;
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/&amp;/g, "&"));
    } catch {
      /* fall through to raw href */
    }
  }
  if (href.startsWith("//")) return "https:" + href;
  return href;
}

/** Parse DuckDuckGo HTML results */
export function parseDdgResults(html, limit) {
  const results = [];
  // Match result blocks: each has a link (.result__a) and snippet (.result__snippet).
  // Attribute order varies (rel/class/href), so don't assume class precedes href.
  const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [];
  let m;
  while ((m = blockRe.exec(html)) !== null && links.length < limit * 2) {
    // DDG wraps every external link in a //duckduckgo.com/l/?uddg= redirect —
    // decode it to the real target instead of discarding it (the old code
    // dropped everything containing "duckduckgo.com", yielding zero results).
    const url = unwrapDdgUrl(m[1]);
    const title = extractText(m[2]).trim();
    if (url && title && !/^https?:\/\/(?:[a-z]+\.)?duckduckgo\.com\//i.test(url) && !url.startsWith("//duckduckgo")) {
      links.push({ url, title });
    }
  }

  const snippets = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(extractText(m[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, limit); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  // Fallback: if no structured results found, try simpler extraction
  if (results.length === 0) {
    const hrefRe = /href="(https?:\/\/[^"]+)"[^>]*>([^<]{5,})/gi;
    while ((m = hrefRe.exec(html)) !== null && results.length < limit) {
      const url = m[1];
      const text = extractText(m[2]).trim();
      if (!url.includes("duckduckgo") && text.length > 10) {
        results.push({ title: text.slice(0, 120), url, snippet: "" });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Mode 1: DuckDuckGo scraping
// ---------------------------------------------------------------------------

async function searchDdg(query, limit = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await nodeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  const results = parseDdgResults(html, limit);

  if (results.length === 0) {
    // Return raw text excerpt as fallback
    const text = extractText(html).slice(0, 2000);
    return { mode: "ddg", query, results: [], raw_excerpt: text };
  }

  return { mode: "ddg", query, results };
}

// ---------------------------------------------------------------------------
// Mode 2: Brave Search API
// ---------------------------------------------------------------------------

async function searchBrave(query, limit = 5) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error("BRAVE_API_KEY not set in environment");

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await nodeFetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brave API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const webResults = data?.web?.results || [];
  const results = webResults.slice(0, limit).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description || "",
    age: r.age || null,
  }));

  return { mode: "brave", query, results };
}

// ---------------------------------------------------------------------------
// Mode 3: Puppeteer Google fallback
// ---------------------------------------------------------------------------

async function searchBrowser(query, limit = 5) {
  try {
    // Navigate to Google
    await browser_navigate({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en` });

    // Extract search results via JS in page context
    const { result } = await browser_evaluate({
      code: `
        (function() {
          const items = [];
          const cards = document.querySelectorAll('div.g, div[data-sokoban-container]');
          for (const card of cards) {
            const a = card.querySelector('a[href^="http"]');
            const h3 = card.querySelector('h3');
            const snippet = card.querySelector('.VwiC3b, [data-sncf], .s3v9rd');
            if (a && h3) {
              items.push({
                title: h3.innerText || h3.textContent || '',
                url: a.href || '',
                snippet: snippet ? (snippet.innerText || snippet.textContent || '') : '',
              });
            }
            if (items.length >= ${limit}) break;
          }
          return items;
        })()
      `,
    });

    const results = Array.isArray(result) ? result.slice(0, limit) : [];

    if (results.length === 0) {
      // Fallback to page text
      const { text } = await browser_get_text();
      return { mode: "browser", query, results: [], raw_excerpt: text.slice(0, 2000) };
    }

    return { mode: "browser", query, results };
  } catch (e) {
    throw new Error(`Browser search failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Auto mode: tries DDG → Brave → Browser
// ---------------------------------------------------------------------------

async function searchAuto(query, limit = 5) {
  const errors = [];

  // 1. Try DuckDuckGo
  try {
    const r = await searchDdg(query, limit);
    if (r.results && r.results.length > 0) return r;
    errors.push("ddg: 0 results");
  } catch (e) {
    errors.push(`ddg: ${e.message}`);
  }

  // 2. Try Brave (only if key is set)
  if (process.env.BRAVE_API_KEY) {
    try {
      const r = await searchBrave(query, limit);
      if (r.results && r.results.length > 0) return r;
      errors.push("brave: 0 results");
    } catch (e) {
      errors.push(`brave: ${e.message}`);
    }
  }

  // 3. Try browser
  try {
    const r = await searchBrowser(query, limit);
    return r;
  } catch (e) {
    errors.push(`browser: ${e.message}`);
  }

  throw new Error(`All search modes failed: ${errors.join("; ")}`);
}

// ---------------------------------------------------------------------------
// Main search dispatcher
// ---------------------------------------------------------------------------

export async function webSearch({ query, mode = "auto", limit = 5 }) {
  if (!query) throw new Error("query required");
  const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);

  switch (mode) {
    case "ddg":     return searchDdg(query, n);
    case "brave":   return searchBrave(query, n);
    case "browser": return searchBrowser(query, n);
    case "auto":    return searchAuto(query, n);
    default: throw new Error(`Unknown mode "${mode}". Use: auto, ddg, brave, browser`);
  }
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildSearchRouter(express) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      const result = await webSearch(req.body || {});
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET convenience: /tools/search?q=...&mode=auto&limit=5
  router.get("/", async (req, res) => {
    const { q, query, mode, limit } = req.query;
    try {
      const result = await webSearch({ query: q || query, mode, limit });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
