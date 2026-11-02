import assert from "node:assert/strict";
import { test } from "node:test";
import { publicMarketingRoutes, sitemapErrors } from "./sitemap.mjs";

const site = "https://example.com";
const page = (url, extra = "") => `<html><head><link href="${url}" rel="canonical">${extra}</head><body></body></html>`;

test("sitemap follows the complete built inventory as bilingual documentation grows", () => {
  for (const base of ["/", "/preview", "/preview/"]) {
    const prefix = base.replace(/\/+$/, "");
    const pages = new Map();
    const urls = [];
    for (const locale of ["", "es/"]) {
      for (const slug of [
        "",
        "compare/",
        "docs/start/introduction/",
        "docs/apps/overview/",
        "docs/computers/overview/",
      ]) {
        const route = `/${locale}${slug}`;
        const url = `${site}${prefix}${route}`;
        pages.set(route, page(url));
        urls.push(url);
      }
    }
    assert.deepEqual(sitemapErrors(pages, urls, site, base), []);
    const added = `${site}${prefix}/docs/reference/new-guide/`;
    pages.set("/docs/reference/new-guide/", page(added));
    assert.deepEqual(sitemapErrors(pages, urls, site, base), [`sitemap: missing canonical route: ${added}`]);
    assert.deepEqual(sitemapErrors(pages, [...urls, added], site, base), []);
  }
});

test("sitemap rejects omissions, duplicates, unknown URLs and foreign origins even at an unchanged total", () => {
  const pages = new Map([
    ["/", page(`${site}/`)],
    ["/es/", page(`${site}/es/`)],
  ]);
  assert.deepEqual(sitemapErrors(pages, [`${site}/`, `${site}/`], site), [
    `sitemap: duplicate URL: ${site}/`,
    `sitemap: missing canonical route: ${site}/es/`,
  ]);
  for (const wrong of [`${site}/lost/`, "https://other.example.com/es/"]) {
    assert.deepEqual(sitemapErrors(pages, [`${site}/`, wrong], site), [
      `sitemap: not an indexable built route: ${wrong}`,
      `sitemap: missing canonical route: ${site}/es/`,
    ]);
  }
});

test("sitemap excludes noindex pages and legacy redirects even if their canonical points at a real page", () => {
  const pages = new Map([
    ["/", page(`${site}/`)],
    ["/hidden/", page(`${site}/hidden/`, '<meta content="noindex,follow" name="robots">')],
    ["/legacy/", page(`${site}/`, '<meta content="0;url=/" http-equiv="refresh">')],
    ["/private/", page(`${site}/private/`, '<meta name="robots" content="NONE">')],
  ]);
  assert.deepEqual(sitemapErrors(pages, [`${site}/`], site), []);
  for (const route of ["hidden", "legacy", "private"]) {
    const url = `${site}/${route}/`;
    assert.deepEqual(sitemapErrors(pages, [`${site}/`, url], site), [`sitemap: not an indexable built route: ${url}`]);
  }
});

for (const failure of ["missing", "noindex", "redirect"]) {
  test(`required public routes cannot become ${failure} while disappearing from the sitemap`, () => {
    for (const base of ["/", "/preview", "/preview/"]) {
      const prefix = base.replace(/\/+$/, "");
      const address = (route) => `${site}${prefix}${route}`;
      const pages = new Map(publicMarketingRoutes.map((route) => [route, page(address(route))]));
      const urls = publicMarketingRoutes.map(address);
      assert.deepEqual(sitemapErrors(pages, urls, site, base, publicMarketingRoutes), []);
      for (const route of publicMarketingRoutes) {
        const changed = new Map(pages);
        if (failure === "missing") changed.delete(route);
        else
          changed.set(
            route,
            page(
              address(route),
              failure === "noindex"
                ? '<meta name="robots" content="noindex,follow">'
                : '<meta http-equiv="refresh" content="0;url=/">',
            ),
          );
        const listed = urls.filter((url) => url !== address(route));
        assert.deepEqual(
          sitemapErrors(changed, listed, site, base, publicMarketingRoutes),
          [
            `${route}: required public page is missing or not indexable`,
            `sitemap: missing canonical route: ${address(route)}`,
          ],
          `${failure}: ${base} ${route}`,
        );
      }
    }
  });
}

test("built indexable routes need a self canonical, not an alias or a missing tag", () => {
  assert.deepEqual(sitemapErrors(new Map([["/", page(`${site}/es/`)]]), [`${site}/`], site), [
    `/: expected self canonical ${site}/, got ${site}/es/`,
  ]);
  assert.deepEqual(sitemapErrors(new Map([["/", "<html><head></head></html>"]]), [`${site}/`], site), [
    `/: expected self canonical ${site}/, got none`,
  ]);
});
