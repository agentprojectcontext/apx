// Keep the public route contract independent of the build and the comparison catalog.
export const publicMarketingRoutes = ["", "es/"].flatMap((locale) =>
  [
    "",
    "compare/",
    "compare/best-ai-agent-apps/",
    "compare/chatgpt-dots/",
    "compare/claude-cowork/",
    "compare/devin/",
    "compare/grok-bot/",
    "compare/hermes-agent/",
    "compare/instinct/",
    "compare/manus/",
    "compare/muse/",
    "compare/openbot/",
    "compare/openclaw/",
    "compare/paperclip/",
    "compare/viktor/",
  ].map((route) => `/${locale}${route}`),
);

/** Compare sitemap addresses with the indexable HTML routes produced by the same build. */
export function sitemapErrors(pages, urls, site, base = "/", requiredRoutes = []) {
  const prefix = base.replace(/\/+$/, "");
  const expected = new Set();
  const errors = [];
  for (const [route, html] of pages) {
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
    const tags = [...head.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value]),
      ),
    );
    if (tags.some((tag) => tag["http-equiv"]?.toLowerCase() === "refresh")) continue;
    if (tags.some((tag) => tag.name?.toLowerCase() === "robots" && /\b(?:noindex|none)\b/i.test(tag.content ?? "")))
      continue;
    const address = new URL(`${prefix}${route}`, site).href;
    const canonical = tags.find((tag) => tag.rel === "canonical")?.href;
    if (canonical !== address) errors.push(`${route}: expected self canonical ${address}, got ${canonical ?? "none"}`);
    expected.add(address);
  }
  for (const route of requiredRoutes) {
    const address = new URL(`${prefix}${route}`, site).href;
    if (!expected.has(address)) errors.push(`${route}: required public page is missing or not indexable`);
    expected.add(address);
  }
  const listed = new Set();
  for (const url of urls) {
    if (listed.has(url)) errors.push(`sitemap: duplicate URL: ${url}`);
    listed.add(url);
    if (!expected.has(url)) errors.push(`sitemap: not an indexable built route: ${url}`);
  }
  for (const url of expected) {
    if (!listed.has(url)) errors.push(`sitemap: missing canonical route: ${url}`);
  }
  return errors;
}
