import assert from "node:assert/strict";
import { test } from "node:test";
import { rawMessage } from "./gmail.ts";

test("Gmail raw messages carry plain and HTML alternatives without losing reply headers", () => {
  const raw = Buffer.from(
    rawMessage({
      to: ["user@example.com"],
      subject: "Reply",
      body: "Hello\nAcme",
      html: "<p>Hello</p><b>Acme</b>",
      inReplyTo: "<original@example.com>",
    }),
    "base64url",
  ).toString("utf8");
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /In-Reply-To: <original@example.com>/);
  assert.ok(raw.includes(Buffer.from("Hello\r\nAcme").toString("base64")));
  assert.ok(raw.includes(Buffer.from("<p>Hello</p><b>Acme</b>").toString("base64")));
});
