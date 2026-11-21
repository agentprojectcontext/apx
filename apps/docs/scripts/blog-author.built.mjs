import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { BLOG_AUTHOR } from "../src/data/blog-author.mjs";

const root = new URL("../dist/", import.meta.url);
const base = (process.env.DOCS_BASE ?? "/").replace(/\/?$/, "/");
const site = process.env.DOCS_SITE ?? "https://apxagent.app";
const absolute = (path) => new URL(`${base}${path}`, site).href;

for (const lang of ["en", "es"]) {
  test(`every published ${lang} article has shared authorship and complete SEO metadata`, async () => {
    const pre = lang === "es" ? "es/" : "";
    const entries = await readdir(new URL(`${pre}blog/`, root), { withFileTypes: true });
    let count = 0;
    const titles = new Set();
    const descriptions = new Set();
    const sitemap = await readFile(new URL("sitemap-0.xml", root), "utf8");
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "page") continue;
      const route = `${pre}blog/${entry.name}/`;
      const html = await readFile(new URL(`${route}index.html`, root), "utf8");
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
      const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
      assert.ok(title && description, route);
      assert.ok(!titles.has(title), `duplicate title: ${route}`);
      assert.ok(!descriptions.has(description), `duplicate description: ${route}`);
      titles.add(title);
      descriptions.add(description);
      assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, route);
      assert.ok(html.includes(`rel="canonical" href="${absolute(route)}"`), route);
      for (const alternate of ["", "es/"]) {
        assert.ok(
          html.includes(`hreflang="${alternate ? "es" : "en"}" href="${absolute(`${alternate}blog/${entry.name}/`)}"`),
          route,
        );
      }
      assert.ok(html.includes('"@type":"BlogPosting"'), route);
      assert.ok(html.includes(`"name":"${BLOG_AUTHOR.name}"`), route);
      assert.ok(html.includes('"datePublished":'), route);
      assert.ok(html.includes('property="og:image"'), route);
      assert.ok(html.includes('class="blog-byline-photo"'), route);
      assert.ok(html.includes('class="blog-author-handle"'), route);
      assert.ok(html.includes(BLOG_AUTHOR[lang].bio), route);
      assert.ok(sitemap.includes(`<loc>${absolute(route)}</loc>`), route);
      count++;
    }
    assert.ok(count > 0);
  });
}
