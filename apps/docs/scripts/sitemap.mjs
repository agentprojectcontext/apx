/** Compare sitemap addresses with the indexable HTML routes produced by the same build. */
export function sitemapErrors(pages, urls, site, base = "/") {
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
