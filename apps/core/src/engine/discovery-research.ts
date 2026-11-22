import type { DiscoverySettings, DiscoverySourceFailure } from "@apx/protocol";
import { getPublic, pageText, searchPublic } from "../tools/web.ts";

export type DiscoveryPage = { url: string; title: string; text: string; read_at: string };
export type DiscoveryWeb = {
  read: (url: string, signal: AbortSignal) => Promise<DiscoveryPage>;
  search: (query: string, signal: AbortSignal) => Promise<string[]>;
};

export const discoveryWeb: DiscoveryWeb = {
  async read(url, signal) {
    const page = await getPublic(url, signal);
    if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
    if (!page.body) throw new Error("The page has no readable text");
    const content =
      /html/i.test(page.type) || /^\s*</.test(page.body)
        ? pageText(page.body, page.url)
        : { title: "", text: page.body };
    if (content.text.trim().length < 80) throw new Error("The page needs a browser or has too little readable text");
    return {
      url: page.url,
      title: content.title.slice(0, 300),
      text: content.text.slice(0, 12_000),
      read_at: new Date().toISOString(),
    };
  },
  async search(query, signal) {
    return (await searchPublic(query, 4, signal)).hits.map((hit) => hit.url);
  },
};

/** Only public terms explicitly configured by the owner leave the core; hypotheses never become queries or URLs. */
export async function researchDiscoverySource(options: {
  source: DiscoverySettings["sources"][number];
  web: DiscoveryWeb;
  signal: AbortSignal;
  take: () => boolean;
  failure: (url: string, reason: string, kind: DiscoverySourceFailure["kind"]) => void;
}): Promise<DiscoveryPage[]> {
  const { source, web, signal, take, failure } = options;
  const pages: DiscoveryPage[] = [];
  const urls = [...source.pages];
  const origins = new Set(source.pages.map((url) => new URL(url).origin));
  const interestSearch = source.pages.length === 0 && !source.project;
  const safe = (raw: string) => {
    try {
      const url = new URL(raw);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        (interestSearch || origins.has(url.origin))
      );
    } catch {
      return false;
    }
  };
  if (source.public_terms && take()) {
    try {
      const hits = await web.search(source.public_terms, signal);
      urls.push(...hits.filter(safe));
    } catch {
      signal.throwIfAborted();
      failure("search", "Search was unavailable; configured pages may still be readable", "search_unavailable");
    }
  }
  const seen = new Set<string>();
  for (let i = 0; i < urls.length && pages.length < 4; i++) {
    signal.throwIfAborted();
    const url = urls[i];
    if (!url || !safe(url) || seen.has(url)) continue;
    seen.add(url);
    if (!take()) break;
    try {
      const page = await web.read(url, signal);
      if (!safe(page.url)) {
        failure(url, "The page redirected outside the authorized sources", "changed_site");
        continue;
      }
      pages.push(page);
      // Follow relevant public sections, not arbitrary links or URLs invented from private context.
      for (const match of page.text.matchAll(/\((https:\/\/[^\s)]+)\)/g)) {
        const link = match[1];
        if (link && safe(link) && /pricing|price|news|blog|release|event|changelog|docs/i.test(link)) urls.push(link);
      }
    } catch {
      signal.throwIfAborted();
      failure(url, "The source could not be read; no claim was verified from it", "unreadable");
    }
  }
  return pages;
}
