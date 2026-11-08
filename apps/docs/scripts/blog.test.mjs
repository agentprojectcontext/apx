import assert from "node:assert/strict";
import { test } from "node:test";
import { archivePath, blogArchive, blogPath, publishedPosts, relatedPosts } from "../src/data/blog.mjs";

const post = (lang, slug, published = "2026-01-01", draft = false) => ({ data: { lang, slug, published, draft } });

test("archive paginates ten published entries per language without overlap", () => {
  const entries = Array.from({ length: 21 }, (_, i) => [post("en", `topic-${i}`), post("es", `topic-${i}`)]).flat();
  entries.push(post("en", "unfinished", "2026-02-01", true));
  for (const lang of ["en", "es"]) {
    const pages = [1, 2, 3].map((page) => blogArchive(entries, lang, page));
    assert.deepEqual(
      pages.map((page) => page.posts.length),
      [10, 10, 1],
    );
    assert.equal(pages[0].totalPages, 3);
    assert.equal(new Set(pages.flatMap(({ posts }) => posts.map(({ data }) => data.slug))).size, 21);
    assert.ok(pages.every(({ posts }) => posts.every(({ data }) => data.lang === lang && !data.draft)));
    for (const invalid of [0, -1, 1.5, 4])
      assert.throws(() => blogArchive(entries, lang, invalid), /Invalid blog page/);
  }
  assert.equal(archivePath(1), "/blog/");
  assert.equal(archivePath(2), "/blog/page/2/");
  assert.deepEqual(blogArchive([], "en"), { posts: [], totalPages: 1 });
});

test("more articles exclude drafts, the current article and other languages", () => {
  const entries = ["one", "two", "three", "four", "five"].flatMap((slug) => [post("en", slug), post("es", slug)]);
  entries.push(post("en", "draft", "2026-02-01", true));
  for (const lang of ["en", "es"]) {
    const result = relatedPosts(entries, post(lang, "one"));
    assert.equal(result.length, 3);
    assert.ok(result.every(({ data }) => data.lang === lang && data.slug !== "one" && !data.draft));
    assert.deepEqual(relatedPosts([post("en", "one"), post("es", "one")], post(lang, "one")), []);
  }
});

test("an empty blog has no fabricated articles", () => {
  assert.deepEqual(publishedPosts([]), []);
});
test("drafts cannot appear as articles, even when their translation is absent", () => {
  assert.deepEqual(publishedPosts([post("en", "unfinished", "2026-01-01", true)]), []);
});
test("publishing requires exactly one article in each language", () => {
  assert.throws(() => publishedPosts([post("en", "guide")]), /Missing blog translation/);
  assert.throws(() => publishedPosts([post("es", "guide")]), /Missing blog translation/);
  assert.throws(() => publishedPosts([post("en", "guide"), post("en", "guide")]), /Duplicate blog article/);
  assert.equal(publishedPosts([post("en", "guide"), post("es", "guide")]).length, 2);
});
test("listing is newest first without mutating the collection", () => {
  const entries = [
    post("en", "old"),
    post("es", "old"),
    post("en", "new", "2026-02-01"),
    post("es", "new", "2026-02-01"),
  ];
  assert.deepEqual(
    publishedPosts(entries).map(({ data }) => data.slug),
    ["new", "new", "old", "old"],
  );
  assert.equal(entries[0].data.slug, "old");
});
test("article updates cannot predate publication", () => {
  const entry = post("en", "guide");
  entry.data.updated = "2025-12-31";
  assert.throws(() => publishedPosts([entry, post("es", "guide")]), /Update precedes publication/);
});
test("article addresses stay in the selected language", () => {
  assert.equal(blogPath(post("en", "guide").data), "/blog/guide/");
  assert.equal(blogPath(post("es", "guide").data), "/es/blog/guide/");
});
