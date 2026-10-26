import assert from "node:assert/strict";
import { test } from "node:test";
import { emailMimeBody } from "./email-body.ts";

const decodeParts = (entity: string) =>
  [
    ...entity.matchAll(
      /Content-Type: (text\/(?:plain|html)); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]*)(?=\r\n--|$)/g,
    ),
  ].map((m) => ({ type: m[1], text: Buffer.from(m[2] ?? "", "base64").toString("utf8") }));

test("plain MIME bodies round-trip Unicode and normalize line endings", () => {
  const entity = emailMimeBody({ text: "Hello\nRésumé\r\nEnd" });
  assert.deepEqual(decodeParts(entity), [{ type: "text/plain", text: "Hello\r\nRésumé\r\nEnd" }]);
  assert.ok(!entity.includes("multipart/alternative"));
});

test("alternative MIME preserves both parts and closes its unique boundary", () => {
  const entity = emailMimeBody({ text: "Hello\nAcme", html: "<p>Hello</p><b>Acme</b>" });
  assert.deepEqual(decodeParts(entity), [
    { type: "text/plain", text: "Hello\r\nAcme" },
    { type: "text/html", text: "<p>Hello</p><b>Acme</b>" },
  ]);
  const boundary = /boundary="([^"]+)"/.exec(entity)?.[1];
  assert.ok(boundary);
  assert.ok(entity.endsWith(`--${boundary}--\r\n`));
  assert.notEqual(entity, emailMimeBody({ text: "Hello\nAcme", html: "<p>Hello</p><b>Acme</b>" }));
});

test("long content is base64 wrapped and cannot inject MIME headers or boundaries", () => {
  const text = `${"Résumé".repeat(100)}\r\nContent-Type: text/html\r\n\r\n--fake`;
  const entity = emailMimeBody({ text });
  assert.deepEqual(decodeParts(entity), [{ type: "text/plain", text }]);
  for (const line of entity.split("\r\n").slice(3)) assert.ok(line.length <= 76);
});
