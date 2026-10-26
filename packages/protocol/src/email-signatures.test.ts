import assert from "node:assert/strict";
import { test } from "node:test";
import { EmailSignatureEntry, EmailSignatures, safeSignatureHtml } from "./email-signatures.ts";

const entry = {
  transport: "gmail",
  account: "user@example.com",
  sender: "user@example.com",
  enabled: true,
  text: "Acme",
};

test("signature HTML permits basic formatting, links and hosted HTTPS images", () => {
  for (const html of [
    "Acme &amp; partners",
    '<div><strong>Acme</strong><br><a href="https://example.com">Website</a></div>',
    '<p><a href="mailto:user@example.com">Email</a><img src="https://example.com/logo.png" alt="Logo" width="100" height="50"></p>',
  ])
    assert.equal(safeSignatureHtml(html), true, html);
});

test("signature HTML rejects executable, ambiguous or unsupported markup", () => {
  for (const html of [
    "<script>alert(1)</script>",
    '<img src="https://example.com" onerror="alert(1)">',
    '<a href="javascript:alert(1)">Go</a>',
    '<a href="jav&#x61;script:alert(1)">Go</a>',
    '<img src="data:image/png;base64,AAAA">',
    '<img src="file:///etc/passwd">',
    '<img src="http://example.com/logo.png">',
    '<img src="//example.com/logo.png">',
    '<a href="https://user:pass@example.com">Go</a>',
    '<a href="https://example.com" href="javascript:alert(1)">Go</a>',
    '<div style="background:url(https://example.com)">Go</div>',
    "<svg></svg>",
    "<!-- comment -->",
    "<b>Missing close",
    "</div>",
    "<p><b>Wrong close</p></b>",
    "<div/>",
    "<br></br>",
    "<img src=https://example.com/logo.png>",
    '<img width="0">',
    '<img height="10000">',
    `${"<div>".repeat(21)}${"</div>".repeat(21)}`,
  ])
    assert.equal(safeSignatureHtml(html), false, html);
});

test("only HTML ASCII whitespace separates tags and attributes", () => {
  for (const whitespace of ["\u00a0", String.fromCharCode(11)]) {
    assert.equal(safeSignatureHtml(`<p${whitespace}>Acme</p>`), false);
    assert.equal(safeSignatureHtml(`<a${whitespace}href="https://example.com">Acme</a>`), false);
  }
  assert.equal(safeSignatureHtml('<a\n\thref = "https://example.com"\r>Acme</a>'), true);
});

test("signature settings bound content and reject duplicates for the same sender", () => {
  assert.equal(EmailSignatureEntry.safeParse(entry).success, true);
  assert.equal(EmailSignatureEntry.safeParse({ ...entry, html: "<script>x</script>" }).success, false);
  assert.equal(EmailSignatureEntry.safeParse({ ...entry, text: " " }).success, false);
  assert.equal(EmailSignatureEntry.safeParse({ ...entry, text: "x".repeat(10_001) }).success, false);
  assert.equal(EmailSignatures.safeParse([entry, { ...entry, sender: "USER@example.com" }]).success, false);
  assert.equal(EmailSignatures.safeParse([entry, { ...entry, account: "other@example.com" }]).success, true);
});
