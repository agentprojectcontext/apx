import assert from "node:assert/strict";
import { test } from "node:test";
import { payload } from "./discord-release.ts";

test("a release note goes in the message above the release, where Discord previews its link", () => {
  const note = "Desde hoy APX v2 es la versión oficial. https://youtu.be/abc";
  const body = payload({ tag: "v2.11.0", previous: "v2.10.3", subjects: ["feat(web): a"], beta: false, note });
  assert.equal(body.content, `**APX** v2.11.0\n${note}`);
  assert.equal(body.embeds[0]?.title, "🚀 APX v2.11.0");
});

test("without a note or the beta mark the message names only the version", () => {
  const body = payload({ tag: "v2.11.1", subjects: [], beta: false });
  assert.equal(body.content, "**APX** v2.11.1");
});
