import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import { createUv, fromTar } from "./uv.ts";

const log = createLog("test", true);
const none = () => undefined;

/** A tar archive holding these files (ustar headers, as uv's release is packed). */
function tar(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const head = Buffer.alloc(512);
    head.write(name, 0);
    head.write(`${Buffer.byteLength(body).toString(8).padStart(11, "0")}\0`, 124);
    head.write("0", 156);
    head.write("ustar\0", 257);
    parts.push(head, Buffer.from(body), Buffer.alloc((512 - (Buffer.byteLength(body) % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

test("uv's program is taken out of its release archive, and nothing else is", () => {
  const archive = tar({ "uv-aarch64-apple-darwin/uvx": "uvx program", "uv-aarch64-apple-darwin/uv": "uv program" });
  assert.equal(String(fromTar(archive, "uv-aarch64-apple-darwin/uv")), "uv program");
  assert.equal(fromTar(archive, "uv-aarch64-apple-darwin/ruff"), undefined);
});

test("the uv on this Mac is used and nothing is downloaded", async () => {
  await using tmp = tempDir("apx-uv-");
  const uv = createUv({ dir: tmp.path, log, find: () => "/opt/homebrew/bin/uv", fetchImpl: () => assert.fail() });
  assert.equal(await uv.path(), "/opt/homebrew/bin/uv");
});

test("a Mac without uv gets the published build into APX's folder, ready to run, once", async () => {
  await using tmp = tempDir("apx-uv-");
  const gz = zlib.gzipSync(tar({ "uv-aarch64-apple-darwin/uv": "uv program" }));
  let downloads = 0;
  const uv = createUv({
    dir: tmp.path,
    log,
    find: none,
    platform: "darwin",
    arch: "arm64",
    build: { name: "uv-aarch64-apple-darwin", sha: sha(gz) },
    fetchImpl: async () => {
      downloads++;
      return new Response(gz);
    },
  });
  assert.equal(uv.downloadable, true);
  assert.equal(uv.now(), undefined);
  const file = await uv.path();
  assert.equal(file, path.join(tmp.path, "uv"));
  assert.equal(fs.readFileSync(file, "utf8"), "uv program");
  if (process.platform !== "win32") assert.ok(fs.statSync(file).mode & 0o100, "it can run");
  assert.equal(await uv.path(), file);
  assert.equal(downloads, 1, "kept, not downloaded again");
});

test("a download that is not the published build is refused, leaves nothing, and is tried again", async () => {
  await using tmp = tempDir("apx-uv-");
  let downloads = 0;
  const uv = createUv({
    dir: tmp.path,
    log,
    find: none,
    platform: "darwin",
    arch: "arm64",
    fetchImpl: async () => {
      downloads++;
      return new Response(zlib.gzipSync(tar({ "uv-aarch64-apple-darwin/uv": "something else" })));
    },
  });
  await assert.rejects(uv.path(), /not the published build/);
  await assert.rejects(uv.path(), /not the published build/);
  assert.equal(downloads, 2);
  assert.deepEqual(fs.readdirSync(tmp.path), []);
});

test("where the voice cannot run there is no uv to download", () => {
  const uv = createUv({ dir: "unused", log, find: none, platform: "linux", arch: "x64" });
  assert.equal(uv.downloadable, false);
});
