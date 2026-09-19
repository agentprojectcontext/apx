// Nothing a tool returns may be big enough to end a turn by itself.
//
// On 2026-09-18 an agent called http_get on a 3.8 MB .mp4 to check a video was
// online. The body came back decoded as UTF-8 — 3.665.297 characters, 43% of
// them U+FFFD — and the turn died at 4.336.896 tokens against a 1.048.576
// limit, having answered nothing. Two holes, both covered here: the tool that
// pretended bytes were text, and the absence of any ceiling under all of them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeBody } from "#core/http-tools/fetch.js";
import { toolContentForModel } from "#core/agent/run-agent.js";

/** Bytes shaped like a real media file: a small header, then binary. */
const binary = (size) => Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]), Buffer.alloc(size, 0xff)]);

test("a binary body is described, never decoded", () => {
  const out = decodeBody(binary(3_862_003), "video/mp4");
  assert.equal(out.binary, true);
  assert.equal(out.bytes, 3_862_011);
  assert.equal(out.json, null);
  // The size of the ANSWER is the whole point: it is a sentence, not a video.
  assert.ok(out.text.length < 500, `el cuerpo son ${out.text.length} chars`);
  assert.match(out.text, /video\/mp4/);
  assert.match(out.text, /not decoded/);
  // And it still answers what a reachability check actually asked.
  assert.match(out.text, /request succeeded/);
  assert.ok(!out.text.includes("�"), "no hay basura de decodificar binario");
});

test("bytes are bytes even when the server swears they are text", () => {
  // A NUL in the first kilobyte settles it. This is the case that matters:
  // a server with a wrong content-type, or none at all.
  assert.equal(decodeBody(binary(5000), "text/plain").binary, true);
  assert.equal(decodeBody(binary(5000), "").binary, true);
});

test("real text still comes back as text", () => {
  const html = decodeBody(Buffer.from("<!doctype html>\n<html>hola</html>"), "text/html; charset=utf-8");
  assert.equal(html.binary, false);
  assert.equal(html.truncated, false);
  assert.match(html.text, /^<!doctype html>/);

  const json = decodeBody(Buffer.from('{"ok":true,"n":3}'), "application/json");
  assert.equal(json.binary, false);
  assert.deepEqual(json.json, { ok: true, n: 3 });
});

test("a huge text body is capped, and says so", () => {
  const out = decodeBody(Buffer.from("x".repeat(2 * 1024 * 1024)), "text/html");
  assert.equal(out.binary, false);
  assert.equal(out.truncated, true);
  assert.equal(out.bytes, 2 * 1024 * 1024, "informa el tamaño REAL, no el recortado");
  assert.ok(out.text.length < 300 * 1024);
  assert.match(out.text, /TRUNCATED/);
  // A document that ends mid-sentence is not a document to parse.
  assert.equal(out.json, null);
});

test("no tool result reaches the model unbounded", () => {
  // The floor under every tool, not just http_get: the next token bomb will
  // come from somewhere else.
  const huge = { stdout: "y".repeat(3_000_000) };
  const content = toolContentForModel(huge, "run_shell");
  assert.ok(content.length < 110_000, `entraron ${content.length} chars al contexto`);
  assert.match(content, /TRUNCATED/);
  assert.match(content, /run_shell returned 3\d{6} characters/);
  // And it tells the model what to do instead of re-running the same call.
  assert.match(content, /Narrow the call/);
});

test("an ordinary result is passed through untouched", () => {
  const r = { exit_code: 0, stdout: "ok\n" };
  assert.equal(toolContentForModel(r, "run_shell"), JSON.stringify(r));
  assert.equal(toolContentForModel(undefined, "x"), "null");
});
