import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist/", import.meta.url);
const base = (process.env.DOCS_BASE ?? "/").replace(/\/?$/, "/");
const site = process.env.DOCS_SITE ?? "https://apxagent.app";
const absolute = (path) => new URL(`${base}${path}`, site).href;

for (const lang of ["en", "es"]) {
  test(`built ${lang} blog has real navigation and reciprocal metadata`, async () => {
    const pre = lang === "es" ? "es/" : "";
    const html = await readFile(new URL(`${pre}blog/index.html`, root), "utf8");
    assert.ok(html.includes(`href="${absolute(`${pre}blog/`)}"`));
    for (const [locale, path] of [
      ["en", "blog/"],
      ["es", "es/blog/"],
    ]) {
      assert.ok(html.includes(`hreflang="${locale}" href="${absolute(path)}"`));
    }
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.ok(html.includes('"@type":"Blog"'));
    assert.ok(html.includes(`href="${base}${pre}blog/"`));
    if (html.includes("blog-empty")) {
      assert.ok(html.includes(`href="${base}${pre}compare/"`));
    }
    const sitemap = await readFile(new URL("sitemap-0.xml", root), "utf8");
    assert.ok(sitemap.includes(`<loc>${absolute(`${pre}blog/`)}</loc>`));
  });
}
