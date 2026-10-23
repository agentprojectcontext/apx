// web_search and web_read: looking things up and reading a page with plain HTTP, from the core itself. They work with
// no desktop app (a phone channel, a server); the embedded browser stays for pages that need JavaScript, a login or
// clicks. Search reads the result pages of public engines (no key), first one that answers.
import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { untrusted } from "./result.ts";
import { type Confirm, defineTool, type Tool } from "./types.ts";

/**
 * A URL that carries values (a query) can send something out to whoever runs that site: after outside content it
 * asks, like any other way out. See DECISIONS.md#d-057
 */
export function urlConfirm(url: unknown): Confirm {
  try {
    const u = new URL(String(url));
    // Values sent to this computer itself (a dev server) leave nothing with someone else.
    return u.search.length > 1 && !LOOPBACK.test(u.hostname) ? "untrusted" : "never";
  } catch {
    return "never";
  }
}

const LOOPBACK = /^(localhost|[\w-]+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const MAX_BYTES = 3 * 1024 * 1024;
const PAGE_CHARS = 12_000;
const MAX_REDIRECTS = 5;

export type Hit = { title: string; url: string; snippet: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
const strip = (s: string) =>
  decode(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

// ── where a request may go ─────────────────────────────────────────────

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** This machine, the local network, link-local (cloud metadata) and multicast: never fetched for an agent. */
export function blockedAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)?.[1];
  if (mapped) return privateV4(mapped);
  if (net.isIPv4(v)) return privateV4(v);
  if (net.isIPv6(v)) return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  return true;
}

/** A public http(s) address, checked on what its name resolves to (a name can point at this machine). */
async function publicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) pages");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^metadata\.goog(le\.internal)?\.?$/i.test(host)) throw new Error("that address is not public");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(blockedAddress)) throw new Error("that address is not public");
  return u;
}

/** GET with redirects followed by hand, each hop checked again; the body cut at MAX_BYTES. */
export async function getPublic(
  raw: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<{ url: string; type: string; body: string; status: number }> {
  let url = await publicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...headers },
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      url = await publicUrl(new URL(next, url).toString());
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    const bytes = Buffer.concat(chunks);
    const textual = !type || /^text\/|json|xml|javascript/i.test(type);
    return { url: url.toString(), type, status: res.status, body: textual ? bytes.toString("utf8") : "" };
  }
}

// ── a page as text ─────────────────────────────────────────────────────

/** An HTML page as readable text: its title and description, headings marked, links kept as "text (url)". */
export function pageText(html: string, base: string): { title: string; text: string } {
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
  const main = /<(main|article)\b[\s\S]*?<\/\1>/i.exec(html)?.[0];
  const body = (main ?? /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ?? html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${strip(t)}\n\n`,
    )
    .replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const label = strip(t);
      if (!label) return " ";
      try {
        const abs = new URL(decode(href), base);
        return abs.protocol.startsWith("http") ? ` ${label} (${abs}) ` : ` ${label} `;
      } catch {
        return ` ${label} `;
      }
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|tr|li|ul|ol|table|blockquote|pre|dd|dt)>/gi, "\n");
  const text = decode(body.replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text: desc ? `${decode(desc)}\n\n${text}` : text };
}

// ── search engines' result pages ───────────────────────────────────────

export function braveHits(html: string): Hit[] {
  return html
    .split('data-type="web"')
    .slice(1)
    .flatMap((b) => {
      const url = /<a[^>]+href="(https?:\/\/[^"]+)"/.exec(b)?.[1];
      const title = /search-snippet-title[^"]*"[^>]*title="([^"]*)"/.exec(b)?.[1];
      const snippet = /class="generic-snippet[^"]*"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/.exec(b)?.[1] ?? "";
      return url && title ? [{ url: decode(url), title: decode(title), snippet: strip(snippet) }] : [];
    });
}

/** Bing hides each result behind its click tracker; the real address rides in its `u` parameter (base64). */
export function bingHits(html: string): Hit[] {
  return [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)].flatMap(([b]) => {
    const a = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a?.[1] || !a[2]) return [];
    let url = decode(a[1]);
    const u = /[?&]u=a1([^&]+)/.exec(url)?.[1];
    if (u) url = Buffer.from(u.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (!/^https?:\/\//.test(url)) return [];
    return [{ url, title: strip(a[2]), snippet: strip(/<p[^>]*>([\s\S]*?)<\/p>/.exec(b)?.[1] ?? "") }];
  });
}

export function ddgHits(html: string): Hit[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].flatMap(([, attrs = "", t = ""]) => {
    const href = /href=['"]([^'"]+)['"]/.exec(attrs)?.[1];
    if (!href || !/class=['"][^'"]*result-link/.test(attrs)) return [];
    const real = /[?&]uddg=([^&]+)/.exec(decode(href))?.[1];
    const url = real ? decodeURIComponent(real) : decode(href);
    return /^https?:\/\//.test(url) ? [{ url, title: strip(t), snippet: "" }] : [];
  });
}

const ENGINES: Array<{ name: string; url: (q: string) => string; parse: (html: string) => Hit[] }> = [
  { name: "brave", url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`, parse: braveHits },
  { name: "bing", url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`, parse: bingHits },
  { name: "duckduckgo", url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, parse: ddgHits },
];

/** What a sealed chat (a room, a contact's) may get when its channel allows research: nothing else opens with it. */
export const WEB_TOOLS: ReadonlySet<string> = new Set(["web_search", "web_read"]);

export function webTools(): Tool[] {
  return [
    defineTool({
      name: "web_search",
      description:
        "Search the web (no browser needed, works from any channel): titles, addresses and snippets of the top results. Then web_read a result to read it.",
      args: z.object({
        query: z.string().trim().min(2).max(300),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      effect: "external",
      deadlineMs: 60_000,
      title: (a) => `Searched ${String(a.query ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const failed: string[] = [];
        for (const e of ENGINES) {
          try {
            const page = await getPublic(e.url(a.query), ctx.signal, { "accept-language": "es,en;q=0.8" });
            const hits = e.parse(page.body).slice(0, a.limit ?? 6);
            if (!hits.length) {
              failed.push(`${e.name}: no results`);
              continue;
            }
            const list = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`);
            return untrusted("web_search", { query: a.query, engine: e.name }, list.join("\n"));
          } catch (err) {
            if (ctx.signal.aborted) throw err;
            failed.push(`${e.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return `no search engine answered (${failed.join("; ")}). If the desktop app is open, try the browser.`;
      },
    }),
    defineTool({
      name: "web_read",
      description:
        "Read a web page as text (no browser needed, works from any channel): title, description, headings and links. Long pages come in parts (offset). If the text is empty or says to enable JavaScript, the page needs the browser.",
      args: z.object({
        url: z.string().min(8).max(2000),
        offset: z.number().int().min(0).optional().describe("char offset for the next part"),
      }),
      effect: "external",
      confirm: (a) => urlConfirm(a.url),
      untrustedWhy: "url_data",
      deadlineMs: 45_000,
      title: (a) => {
        try {
          return `Read ${new URL(String(a.url)).host}`;
        } catch {
          return "Read a page";
        }
      },
      async run(a, ctx) {
        const page = await getPublic(a.url, ctx.signal);
        if (page.status >= 400) return `the page answered HTTP ${page.status}`;
        if (!page.body) return `not text (${page.type || "unknown type"}): nothing to read`;
        const html = /html/i.test(page.type) || /^\s*</.test(page.body);
        const { title, text } = html ? pageText(page.body, page.url) : { title: "", text: page.body };
        const from = a.offset ?? 0;
        const part = text.slice(from, from + PAGE_CHARS);
        const more =
          from + PAGE_CHARS < text.length
            ? `\n[${text.length} chars in all; call again with offset ${from + PAGE_CHARS}]`
            : "";
        const body = `${title ? `${title}\n${page.url}\n\n` : `${page.url}\n\n`}${part || "(no readable text: the page probably needs JavaScript; use the browser)"}`;
        return `${untrusted("web_page", { url: page.url }, body)}${more}`;
      },
    }),
  ];
}
