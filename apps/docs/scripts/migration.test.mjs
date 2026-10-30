import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const dist = new URL("../dist/", import.meta.url);
const base = (process.env.DOCS_BASE ?? "/").replace(/\/$/, "");
const site = process.env.DOCS_SITE ?? "https://apxagent.app";

test("every built documentation page has a legacy redirect and a canonical new address", async () => {
  let count = 0;
  for (const prefix of ["", "es/"]) {
    const entries = await readdir(new URL(`${prefix}docs/`, dist), { recursive: true });
    for (const file of entries.filter((entry) => entry.endsWith("index.html") && entry !== "index.html")) {
      const route = `${prefix}docs/${file.replace(/index\.html$/, "")}`;
      const html = await readFile(new URL(`${route}index.html`, dist), "utf8");
      const canonical = new URL(`${base}/${route}`, site).href;
      assert.ok(html.includes(`rel="canonical" href="${canonical}"`), route);
      const legacy = route.replace(/^(es\/)?docs\//, "$1");
      const redirect = await readFile(new URL(`${legacy}index.html`, dist), "utf8");
      assert.ok(redirect.includes(`content="0;url=${base}/${route}"`), legacy);
      assert.ok(redirect.includes(`rel="canonical" href="${canonical}"`), legacy);
      assert.ok(redirect.includes('content="noindex,follow"'), legacy);
      count++;
    }
  }
  assert.equal(count, 78, "all existing documentation pages are preserved");
});

test("sitemap lists only canonical pages, including bilingual documentation and comparisons", async () => {
  const xml = await readFile(new URL("sitemap-0.xml", dist), "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(urls.length, 88);
  assert.ok(urls.includes(`${site}${base}/docs/start/introduction/`));
  assert.ok(urls.includes(`${site}${base}/es/docs/start/introduction/`));
  assert.ok(urls.includes(`${site}${base}/compare/openbot/`));
  assert.ok(!urls.includes(`${site}${base}/start/introduction/`));
  assert.ok(!urls.includes(`${site}${base}/es/start/introduction/`));
  assert.ok(!urls.includes(`${site}${base}/docs/`));
});
