import assert from "node:assert/strict";
import { test } from "node:test";
import { byRelease, isUnread, latest, type NewsItem, unreadOf, withRead } from "./newsModel.ts";

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
  assert.equal(unreadOf(entries, ["old", "new"]).length > 0, false, "all read");
  assert.equal(unreadOf(entries, ["old", "other"]).length > 0, true, "one that applies is unread");
  assert.equal(unreadOf(entries, null).length > 0, true, "nothing opened here: the newest release counts");
  assert.equal(unreadOf([item("old", "2.9.0"), item("x", "2.11.2", false)], null).length > 0, false);
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
  assert.equal(unreadOf(entries, read).length > 0, true);
  // Opening every release reads them all.
  assert.equal(
    unreadOf(
      entries,
      withRead(
        entries,
        read,
        entries.map((e) => e.id),
      ),
    ).length > 0,
    false,
  );
  // A later release is unread again.
  const later = [...entries, item("c", "2.12.0")];
  assert.equal(isUnread(later.at(-1) as NewsItem, later, withRead(entries, read, ["b"])), true);
});

test("a release with more news than the menu has lines keeps the rest unread until All the news is opened", () => {
  const entries = ["a", "b", "c", "d", "e"].map((id) => item(id, "2.14.0"));
  const shown = latest(entries);
  // Every line the menu shows opened, one by one.
  const read = shown.reduce<string[] | null>((r, e) => withRead(entries, r, [e.id]), null);
  assert.deepEqual(
    unreadOf(entries, read).map((e) => e.id),
    ["d", "e"],
  );
  assert.deepEqual(
    unreadOf(
      entries,
      withRead(
        entries,
        read,
        entries.map((e) => e.id),
      ),
    ),
    [],
  );
});
