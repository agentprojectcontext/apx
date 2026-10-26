import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmailDraft, textHtml, withEmailSignature } from "./email-signature.ts";

const signature = { text: "Acme\nSupport", html: '<a href="https://example.com">Acme</a><br>Support' };

test("no configured signature preserves both original alternatives", () => {
  const draft = { content: { text: "Hello\n", html: "<p>Hello</p>" } };
  assert.deepEqual(withEmailSignature(draft, undefined), draft);
  assert.deepEqual(withEmailSignature(draft, { text: "  ", html: "<b>Ignored</b>" }), draft);
});

test("plain signatures stay plain and use the standard signature separator", () => {
  assert.deepEqual(withEmailSignature({ content: { text: "Hello" } }, { text: "Acme" }), {
    content: { text: "Hello\n\n-- \nAcme" },
  });
});

test("HTML signatures preserve links and hosted image references without fetching them", () => {
  const html = '<a href="https://example.com">Acme</a><img src="https://example.com/logo.png" alt="Logo">';
  assert.deepEqual(withEmailSignature({ content: { text: "Hello <team>" } }, { text: "Acme", html }), {
    content: {
      text: "Hello <team>\n\n-- \nAcme",
      html: `Hello &lt;team&gt;<br><br><div>${html}</div>`,
    },
  });
});

test("explicit omission leaves an existing signature alone rather than deleting content", () => {
  const signed = withEmailSignature({ content: { text: "Hello" } }, signature);
  assert.deepEqual(withEmailSignature(signed, signature, { omit: true }), signed);
  assert.deepEqual(withEmailSignature({ content: { text: "Hello" } }, signature, { omit: true }), {
    content: { text: "Hello" },
  });
});

test("applying a signature twice does not duplicate either alternative", () => {
  const signed = withEmailSignature({ content: { text: "Hello" } }, signature);
  assert.deepEqual(withEmailSignature(signed, signature), signed);
});

test("an exact signature suffix accepts CRLF and trailing whitespace without rewriting the body", () => {
  const text = "Hello\r\n\r\n-- \r\nAcme\r\nSupport\r\n";
  assert.deepEqual(withEmailSignature({ content: { text } }, { text: "Acme\nSupport" }), { content: { text } });
});

test("a mention in the message is not mistaken for an existing signature", () => {
  assert.equal(
    withEmailSignature({ content: { text: "Acme\nSupport\nPlease reply" } }, { text: "Acme\nSupport" }).content.text,
    "Acme\nSupport\nPlease reply\n\n-- \nAcme\nSupport",
  );
});

test("reply and forwarded history stay separate while signing and recomposing", () => {
  const quoted = { text: "Previous message\n\nAcme\nSupport", html: "<p>Previous message</p>" };
  const result = withEmailSignature({ content: { text: "Reply" }, quoted }, signature);
  const recomposed = withEmailSignature(result, signature);
  assert.deepEqual(recomposed, result);
  assert.equal(result.quoted, quoted);
  assert.deepEqual(renderEmailDraft(recomposed), renderEmailDraft(result));
  assert.deepEqual(renderEmailDraft(result), {
    text: "Reply\n\n-- \nAcme\nSupport\n\nPrevious message\n\nAcme\nSupport",
    html: `Reply<br><br><div>${signature.html}</div><br><br><blockquote>${quoted.html}</blockquote>`,
  });
});

test("an HTML suffix inside a word cannot suppress the signature", () => {
  assert.deepEqual(
    withEmailSignature({ content: { text: "NotAcme", html: "NotAcme" } }, { text: "Acme", html: "Acme" }),
    {
      content: { text: "NotAcme\n\n-- \nAcme", html: "NotAcme<br><br><div>Acme</div>" },
    },
  );
});

test("signing preserves significant trailing whitespace in the author's text", () => {
  assert.equal(
    withEmailSignature({ content: { text: "Line  \n" } }, { text: "Acme" }).content.text,
    "Line  \n\n\n-- \nAcme",
  );
});

test("a pre-signed plain-only draft keeps its footer without duplicating rich content", () => {
  const result = withEmailSignature({ content: { text: "Hello\n\n-- \nAcme\nSupport" } }, signature);
  assert.equal(result.content.html, `Hello<br>\n<br>\n-- <br>\n<div>${signature.html}</div>`);
  assert.deepEqual(withEmailSignature(result, signature), result);
});

test("plain text becomes escaped HTML when the existing body uses HTML", () => {
  assert.deepEqual(
    withEmailSignature({ content: { text: "Hello", html: "<p>Hello</p>" } }, { text: "Acme & <team>" }),
    {
      content: {
        text: "Hello\n\n-- \nAcme & <team>",
        html: "<p>Hello</p><br><br><div>Acme &amp; &lt;team&gt;</div>",
      },
    },
  );
  assert.equal(
    textHtml("\"quoted\" & 'single'\r\n<line>"),
    "&quot;quoted&quot; &amp; &#39;single&#39;<br>\n&lt;line&gt;",
  );
});
