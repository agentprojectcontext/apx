// Progressive disclosure for a project agent's declared skills: a small skill
// is injected whole, a large one (or one with images) becomes a card the agent
// pages with read_skill, and its images become a manifest the agent can attach
// (attach_media) or look at (view_media). These tests pin the parsing, the
// eager/lazy decision, the media dedup, and the three tools end to end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { splitSkillSections, skillOutline, pickSkillSection } from "#core/agent/skills/sections.js";
import { skillAssetsDir, readSkillMedia, findMedia, renderMediaManifest } from "#core/agent/skills/media.js";

const BODY = `# Golf Nivel 2
Intro.

## 1. Distancias
Driver 40 yardas, hierro 25 yardas.

### 1.1 Detalle
sub-detalle

## 2. Swing
Hotdog in the bun.

\`\`\`
## no soy un heading (estoy en un fence)
\`\`\`
`;

test("splitSkillSections — headings own their subsections, fences are not headings", () => {
  const sections = splitSkillSections(BODY);
  const titles = sections.map((s) => s.title);
  assert.ok(titles.includes("1. Distancias"));
  assert.ok(titles.includes("2. Swing"));
  assert.ok(!titles.includes("no soy un heading (estoy en un fence)"), "fenced # is not a heading");
  const distancias = sections.find((s) => s.title === "1. Distancias");
  assert.match(distancias.text, /1\.1 Detalle/, "a ## section carries its ### subsection");
});

test("skillOutline — top-level titles only", () => {
  const outline = skillOutline(BODY);
  assert.deepEqual(outline, ["Golf Nivel 2", "1. Distancias", "2. Swing"]);
});

test("pickSkillSection — by number, by fuzzy title, accent-insensitive", () => {
  assert.equal(pickSkillSection(BODY, "2").title, "2. Swing");
  assert.equal(pickSkillSection(BODY, "swing").title, "2. Swing");
  assert.equal(pickSkillSection(BODY, "distancias").title, "1. Distancias");
  assert.equal(pickSkillSection(BODY, "no-such-section"), null);
});

// ---------------------------------------------------------------------------
// Media manifest — on a temp skill folder
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-media-"));

function makeSkillDir() {
  const dir = path.join(TMP, "golf-lvl-2");
  fs.mkdirSync(dir, { recursive: true });
  // a JPEG magic-byte stub is enough — we only read bytes, not decode
  fs.writeFileSync(path.join(dir, "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, "b.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]));
  fs.writeFileSync(
    path.join(dir, "media.json"),
    JSON.stringify([{ id: "grip", file: "a.jpg", when: "el agarre" }]),
  );
  return dir;
}

test("skillAssetsDir — dir-style skill uses its folder, flat-style uses a sibling", () => {
  assert.equal(skillAssetsDir("/x/golf-lvl-2/SKILL.md"), "/x/golf-lvl-2");
  assert.equal(skillAssetsDir("/x/.apc/skills/golf-lvl-2.md"), "/x/.apc/skills/golf-lvl-2");
});

test("readSkillMedia — manifest entries win, extra images auto-listed, no dupes by file", () => {
  const dir = makeSkillDir();
  const media = readSkillMedia({ slug: "golf-lvl-2", file: path.join(dir, "SKILL.md") });
  const ids = media.map((m) => m.id).sort();
  // "grip" from the manifest (a.jpg), "b" auto-discovered — a.jpg is NOT listed
  // twice under its filename id.
  assert.deepEqual(ids, ["b", "grip"]);
  const grip = findMedia(media, "grip");
  assert.equal(grip.caption, "el agarre");
  assert.equal(grip.file, "a.jpg");
  assert.ok(grip.exists);
});

test("renderMediaManifest — one line per existing image with its caption", () => {
  const dir = makeSkillDir();
  const media = readSkillMedia({ slug: "golf-lvl-2", file: path.join(dir, "SKILL.md") });
  const block = renderMediaManifest(media);
  assert.match(block, /attach with attach_media/);
  assert.match(block, /- grip — el agarre/);
});

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

test("attach_media — queues a valid id into the sink, rejects an unknown id", async () => {
  const { default: attachMedia } = await import("#core/agent/tools/handlers/attach-media.js");
  const sink = [];
  const handler = attachMedia.makeHandler({
    attachableMedia: [{ skill: "golf-lvl-2", id: "grip", path: "/x/a.jpg", mime: "image/jpeg", caption: "el agarre" }],
    mediaSink: sink,
  });
  const ok = await handler({ id: "grip" });
  assert.equal(ok.ok, true);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].path, "/x/a.jpg");
  // idempotent
  await handler({ id: "grip" });
  assert.equal(sink.length, 1, "same id twice attaches once");
  const bad = await handler({ id: "nope" });
  assert.ok(bad.error);
});

test("view_media — returns the image bytes as base64 for the model to see", async () => {
  const { default: viewMedia } = await import("#core/agent/tools/handlers/view-media.js");
  const dir = makeSkillDir();
  const handler = viewMedia.makeHandler({
    attachableMedia: [{ skill: "golf-lvl-2", id: "grip", path: path.join(dir, "a.jpg"), mime: "image/jpeg", caption: "el agarre" }],
  });
  const res = await handler({ id: "grip" });
  assert.equal(res.ok, true);
  assert.equal(res.images.length, 1);
  assert.equal(res.images[0].mime, "image/jpeg");
  assert.ok(res.images[0].data.length > 0, "base64 present");
});
