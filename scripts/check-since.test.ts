import assert from "node:assert/strict";
import { test } from "node:test";
import { sinceProblems, type Told } from "./check-since.ts";

const news = (id: string, since: string): Told => ({ kind: "news", id, since });
const slide = (id: string, since: string): Told => ({ kind: "slide", id, since });
const line = (o: { staging: boolean; shipped?: string[]; release?: string }) => ({
  latest: "2.14.3",
  staging: o.staging,
  release: o.release,
  shipped: (item: Told) => (o.shipped ?? []).includes(item.id),
});

test("what a release already has keeps its since, whatever it says", () => {
  assert.deepEqual(
    sinceProblems(
      [news("older", "2.13.0"), slide("sidebar", "2.14.0")],
      line({ staging: true, shipped: ["older", "sidebar"] }),
    ),
    [],
  );
});

test("news no release has yet cannot name a release already cut without it", () => {
  assert.deepEqual(sinceProblems([news("group-chats", "2.14.3")], line({ staging: true })), [
    'news "group-chats" says since 2.14.3, but v2.14.3 does not have it yet: give it the release that will',
  ]);
});

test("staging's work names the next minor; main's the next patch or minor", () => {
  const groups = [slide("groups", "2.14.4")];
  assert.match(sinceProblems(groups, line({ staging: true }))[0] ?? "", /next release of this line is 2\.15\.0/);
  assert.deepEqual(sinceProblems(groups, line({ staging: false })), []);
  assert.deepEqual(sinceProblems([slide("groups", "2.15.0")], line({ staging: true })), []);
  assert.match(sinceProblems([slide("groups", "2.16.0")], line({ staging: false }))[0] ?? "", /2\.14\.4 or 2\.15\.0/);
});

test("at a release, everything new says that release", () => {
  const items = [news("group-chats", "2.15.0"), slide("groups", "2.14.4")];
  assert.deepEqual(sinceProblems(items, line({ staging: false, release: "2.15.0" })), [
    'slide "groups" says since 2.14.4, but it ships in 2.15.0',
  ]);
});

test("a since that is not a version is named", () => {
  assert.deepEqual(sinceProblems([news("odd", "soon")], line({ staging: true })), [
    'news "odd" says since soon, which is not a version',
  ]);
});
