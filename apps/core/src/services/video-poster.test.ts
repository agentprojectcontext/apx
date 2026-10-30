import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { videoPosters } from "./video-poster.ts";

test("a video's poster is made once and kept; one that fails is not tried again", async () => {
  await using tmp = tempDir("apx-posters-");
  const dir = tmp.path;
  const video = path.join(dir, "clip.mp4");
  fs.writeFileSync(video, "mp4");
  let made = 0;
  const posters = videoPosters(path.join(dir, "out"), async (_video, out) => {
    made++;
    fs.writeFileSync(out, "jpg");
  });
  assert.equal((await posters.of("med_a", video))?.toString(), "jpg");
  assert.equal((await posters.of("med_a", video))?.toString(), "jpg");
  assert.equal(made, 1);
  assert.equal(await posters.of("med_gone", path.join(dir, "missing.mp4")), undefined);

  let tries = 0;
  const broken = videoPosters(path.join(dir, "broken"), async () => {
    tries++;
    throw new Error("no ffmpeg");
  });
  assert.equal(await broken.of("med_b", video), undefined);
  assert.equal(await broken.of("med_b", video), undefined);
  assert.equal(tries, 1);
});

test("a screen of cards makes posters two at a time", async () => {
  await using tmp = tempDir("apx-posters-");
  const dir = tmp.path;
  const video = path.join(dir, "clip.mp4");
  fs.writeFileSync(video, "mp4");
  let now = 0;
  let most = 0;
  const posters = videoPosters(path.join(dir, "out"), async (_video, out) => {
    most = Math.max(most, ++now);
    await new Promise((r) => setImmediate(r));
    now--;
    fs.writeFileSync(out, "jpg");
  });
  const all = await Promise.all(Array.from({ length: 6 }, (_, i) => posters.of(`med_${i}`, video)));
  assert.equal(all.filter(Boolean).length, 6);
  assert.equal(most, 2);
});
