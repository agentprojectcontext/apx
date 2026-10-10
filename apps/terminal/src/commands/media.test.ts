import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { extensionOf, image, say, sizeOf, transcribe } from "./media.ts";
import { printed, recordingClient } from "./testing.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-media-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const png = Buffer.from("not really a png");

test("media types become file extensions and --size becomes width and height", () => {
  assert.equal(extensionOf("image/jpeg"), "jpg");
  assert.equal(extensionOf("image/png"), "png");
  assert.equal(extensionOf("audio/mpeg"), "mp3");
  assert.equal(extensionOf("audio/ogg; codecs=opus"), "ogg");
  assert.deepEqual(sizeOf("1024x768"), { width: 1024, height: 768 });
  assert.throws(() => sizeOf("big"), /WxH/);
});

test("image draws, fetches the bytes and writes them to --out", async () => {
  const out = path.join(dir, "fox.png");
  const { client, calls } = recordingClient({
    "media.image": { media: [{ id: "med_1", mime: "image/png" }], service: "homelab", skipped: ["cloud: down"] },
    "media.get": { mime: "image/png", data: png.toString("base64"), bytes: png.length },
  });
  const said = await printed(() => image(client, ["a", "red", "fox"], { out, size: "512x512" }));
  assert.equal(said, `${out}  homelab  (skipped: cloud: down)`);
  assert.deepEqual(fs.readFileSync(out), png);
  assert.deepEqual(calls, [
    ["media.image", { prompt: "a red fox", width: 512, height: 512 }],
    ["media.get", { id: "med_1" }],
  ]);
});

test("say speaks, and without --out names the file after the media", async () => {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { client, calls } = recordingClient({
      "media.speak": { media: { id: "med_2", mime: "audio/mpeg" }, service: "piper", skipped: [] },
      "media.get": { mime: "audio/mpeg", data: png.toString("base64"), bytes: png.length },
    });
    assert.equal(await printed(() => say(client, ["Good", "morning"], {})), "med_2.mp3  piper");
    assert.ok(fs.existsSync(path.join(dir, "med_2.mp3")));
    assert.deepEqual(calls[0], ["media.speak", { text: "Good morning" }]);
  } finally {
    process.chdir(cwd);
  }
});

test("transcribe sends the file's bytes with its type and prints the words", async () => {
  const file = path.join(dir, "note.m4a");
  fs.writeFileSync(file, png);
  const { client, calls } = recordingClient({ "media.transcribe": { text: "Call Acme at noon", service: "whisper" } });
  assert.equal(await printed(() => transcribe(client, [file])), "Call Acme at noon");
  assert.deepEqual(calls, [["media.transcribe", { data: png.toString("base64"), mime: "audio/mp4" }]]);
  await assert.rejects(transcribe(client, [path.join(dir, "note.txt")]), /unknown audio type/);
});

test("help prints the usage and no argument is a usage error, without calling the core", async () => {
  const { client, calls } = recordingClient({});
  assert.match(await printed(() => image(client, ["help"], {})), /^apx image "<prompt>"/);
  assert.match(await printed(() => say(client, ["help"], {})), /^apx say "<text>"/);
  assert.match(await printed(() => transcribe(client, ["help"])), /^apx transcribe <audio file>/);
  await assert.rejects(image(client, [], {}), /apx image/);
  await assert.rejects(transcribe(client, []), /apx transcribe/);
  assert.equal(calls.length, 0);
});
