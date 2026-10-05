import assert from "node:assert/strict";
import { test } from "node:test";
import { publicVideoUrl, videoTools, vttText } from "./video.ts";

test("captions read as timed paragraphs, the scrolling repeats of automatic captions dropped", () => {
  const vtt = [
    "WEBVTT",
    "Kind: captions",
    "Language: es",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "hola <c>a</c> todos",
    "",
    "00:00:03.000 --> 00:00:05.000",
    "hola a todos",
    "hoy hablamos de memoria",
    "",
    "00:00:40.500 --> 00:00:42.000",
    "y del prefill",
  ].join("\n");
  assert.equal(vttText(vtt), "[0:01] hola a todos hoy hablamos de memoria\n[0:40] y del prefill");
});

test("only a public site's page is fetched, never this machine or a private address", () => {
  assert.ok(publicVideoUrl("https://youtu.be/abc123"));
  assert.ok(publicVideoUrl("https://www.youtube.com/watch?v=abc"));
  for (const bad of [
    "http://127.0.0.1:7440/rpc",
    "http://localhost/x",
    "file:///etc/hosts",
    "http://[::1]/",
    "http://intranet/x",
    "nope",
  ])
    assert.equal(publicVideoUrl(bad), false, bad);
});

test("without yt-dlp the tool is not offered", () => {
  assert.deepEqual(videoTools(undefined), []);
  assert.equal(videoTools("/usr/bin/true")[0]?.name, "video_transcript");
});
