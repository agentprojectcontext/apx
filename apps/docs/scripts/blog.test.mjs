import assert from "node:assert/strict";
import { test } from "node:test";
import { blogPath, publishedPosts } from "../src/data/blog.mjs";

const post = (lang, slug, published = "2026-01-01", draft = false) => ({ data: { lang, slug, published, draft } });

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
