import assert from "node:assert/strict";
import { test } from "node:test";
import { byRelease, hasFresh, isUnread, latest, type NewsItem, withRead } from "./newsModel.ts";

const item = (id: string, since: string, applies = true): NewsItem => ({
  id,
  since,
  title: { en: id, es: id },
  about: { en: "", es: "" },
  seen: true,
  applies,
  actions: [],
});

test("releases come newest first by number, with what applies to the owner first inside each", () => {
  const releases = byRelease([
    item("a", "2.9.0"),
    item("b", "2.11.2", false),
    item("c", "2.11.2"),
    item("d", "2.10.0"),
  ]);
  assert.deepEqual(
    releases.map((r) => [r.version, r.entries.map((e) => e.id)]),
    [
      ["2.11.2", ["c", "b"]],
      ["2.10.0", ["d"]],
      ["2.9.0", ["a"]],
    ],
  );
});

test("the menu shows the newest that apply, else the newest of all", () => {
  const entries = [item("old", "2.9.0"), item("skip", "2.11.2", false), item("new", "2.11.2"), item("mid", "2.10.0")];
  assert.deepEqual(
    latest(entries, 2).map((e) => e.id),
    ["new", "mid"],
  );
  assert.deepEqual(
    latest([item("x", "2.9.0", false), item("y", "2.10.0", false)], 1).map((e) => e.id),
    ["y"],
  );
});

test("the button's dot shows while an entry that applies is unread", () => {
  const entries = [item("old", "2.9.0"), item("new", "2.11.2"), item("other", "2.11.2", false)];
  assert.equal(hasFresh(entries, ["old", "new"]), false, "all read");
  assert.equal(hasFresh(entries, ["old", "other"]), true, "one that applies is unread");
  assert.equal(hasFresh(entries, null), true, "nothing opened here: the newest release counts");
  assert.equal(hasFresh([item("old", "2.9.0"), item("x", "2.11.2", false)], null), false);
});

test("each menu line keeps its dot until that entry is opened", () => {
  const entries = [item("old", "2.9.0"), item("a", "2.11.2"), item("b", "2.11.2"), item("skip", "2.11.2", false)];
  const [old, a, b, skip] = entries as [NewsItem, NewsItem, NewsItem, NewsItem];
  assert.deepEqual(
    [old, a, b, skip].map((e) => isUnread(e, entries, null)),
    [false, true, true, false],
    "first time: the newest release that applies",
  );
  // Opening one reads only it; the older releases stay read and the other new one keeps its dot.
  const read = withRead(entries, null, ["a"]);
  assert.deepEqual(
    [old, a, b].map((e) => isUnread(e, entries, read)),
    [false, false, true],
  );
  assert.equal(hasFresh(entries, read), true);
  // Opening every release reads them all.
  assert.equal(hasFresh(entries, withRead(entries, read, entries.map((e) => e.id))), false);
  // A later release is unread again.
  const later = [...entries, item("c", "2.12.0")];
  assert.equal(isUnread(later.at(-1) as NewsItem, later, withRead(entries, read, ["b"])), true);
});
