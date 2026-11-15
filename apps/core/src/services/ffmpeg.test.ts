import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import { createFfmpeg } from "./ffmpeg.ts";

const log = createLog("test", true);
const none = () => undefined;

test("the ffmpeg on this computer is used and nothing is downloaded", async () => {
  await using tmp = tempDir("apx-ffmpeg-");
  const ffmpeg = createFfmpeg({
    dir: tmp.path,
    log,
    find: () => "/usr/local/bin/ffmpeg",
    fetchImpl: () => assert.fail("nothing to download"),
  });
  assert.equal(await ffmpeg.path(), "/usr/local/bin/ffmpeg");
});

test("without one, a download that is not the published build is refused and tried again next time", async () => {
  await using tmp = tempDir("apx-ffmpeg-");
  const urls: string[] = [];
  const ffmpeg = createFfmpeg({
    dir: tmp.path,
    log,
    find: none,
    platform: "linux",
    arch: "x64",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response(zlib.gzipSync(Buffer.from("not ffmpeg")));
    },
  });
  await assert.rejects(ffmpeg.path(), /not the published build/);
  await assert.rejects(ffmpeg.path(), /not the published build/);
  assert.equal(urls.length, 2);
  assert.match(urls[0] ?? "", /\/ffmpeg-linux-x64\.gz$/);
  assert.deepEqual(fs.readdirSync(tmp.path), [], "nothing half-written is left");
});

test("a build kept in APX's folder is used without downloading it again", async () => {
  await using tmp = tempDir("apx-ffmpeg-");
  const kept = path.join(tmp.path, "ffmpeg.exe");
  fs.writeFileSync(kept, "exe");
  const ffmpeg = createFfmpeg({
    dir: tmp.path,
    log,
    find: none,
    platform: "win32",
    arch: "x64",
    fetchImpl: () => assert.fail("nothing to download"),
  });
  assert.equal(await ffmpeg.path(), kept);
});

test("a system with no build says to install ffmpeg", async () => {
  await using tmp = tempDir("apx-ffmpeg-");
  const ffmpeg = createFfmpeg({ dir: tmp.path, log, find: none, platform: "freebsd", arch: "x64" });
  await assert.rejects(ffmpeg.path(), /no ffmpeg build for freebsd-x64; install ffmpeg/);
});
