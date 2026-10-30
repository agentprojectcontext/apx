import assert from "node:assert/strict";
import { test } from "node:test";
import { byRelease, latest, type NewsItem } from "./newsModel.ts";

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
