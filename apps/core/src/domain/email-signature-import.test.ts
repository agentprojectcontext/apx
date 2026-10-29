import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSignatureHtml } from "@apx/protocol";
import { importedSignature } from "./email-signature-import.ts";

test("Gmail's rich signature keeps its links, image and lines in APX's subset, with its text beside", () => {
  const gmail = `<div dir="ltr"><div style="color:rgb(34,34,34)"><font face="arial" size="2"><b>Alex Rivera</b></font><br>CTO &middot; Acme</div><table cellpadding="0"><tr><td><a href="https://www.example.com" target="_blank" style="color:blue">www.example.com</a></td></tr><tr><td><img src="https://example.com/logo.png" width="96" height="32" alt="Acme" style="display:block"></td></tr></table><div><span>+1&nbsp;555&nbsp;0100</span></div><style>p{color:red}</style><script>alert(1)</script></div>`;
  const got = importedSignature(gmail);
  assert.equal(got.text, "Alex Rivera\nCTO · Acme\nwww.example.com\n+1 555 0100");
  assert.ok(got.html && safeSignatureHtml(got.html), got.html);
  assert.match(got.html ?? "", /<a href="https:\/\/www\.example\.com">www\.example\.com<\/a>/);
  assert.match(got.html ?? "", /<img src="https:\/\/example\.com\/logo\.png" width="96" height="32" alt="Acme">/);
  assert.doesNotMatch(got.html ?? "", /style|target|font|table|script|alert|color:red/);
});

test("links APX cannot keep lose their address, not their words; a plain signature stays text only", () => {
  const got = importedSignature(`<a href="http://insecure.example.com">Site</a> <a href="javascript:alert(1)">x</a>`);
  assert.ok(got.html && safeSignatureHtml(got.html));
  assert.doesNotMatch(got.html ?? "", /href/);
  assert.equal(got.text, "Site x");
  assert.deepEqual(importedSignature("Alex Rivera · Acme"), { text: "Alex Rivera · Acme" });
  assert.deepEqual(importedSignature(""), { text: "" });
});
