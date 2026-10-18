import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChip, AvatarStack, Button, EntityCard, LiveBrowserCard, SystemNote, VoiceNote } from "../dist/index.js";

test("avatar stacks cap visible participants and preserve the hidden participant count", () => {
  const props = {
    max: 2,
    size: 32,
    children: [
      h("span", { key: "a" }, "Acme"),
      h("span", { key: "b" }, "Northwind"),
      h("span", { key: "c" }, "Hidden"),
    ],
  };
  const html = renderToStaticMarkup(h(AvatarStack, props));
  assert.match(html, /Acme/);
  assert.match(html, /Northwind/);
  assert.doesNotMatch(html, /Hidden/);
  assert.match(html, />\+1</);
  assert.equal((html.match(/class="apx-avatar-stack__item"/g) ?? []).length, 2);
});

test("entity cards keep repeated field names, escape draft contents and expose recovery actions", () => {
  const html = renderToStaticMarkup(
    h(
      EntityCard,
      {
        eyebrow: "Email draft",
        title: "Review before sending",
        fields: [
          { label: "To", value: "Acme" },
          { label: "To", value: "Northwind" },
        ],
        actions: h(Button, {}, "Discard"),
      },
      "<script>unsafe()</script>",
    ),
  );
  assert.equal((html.match(/<dt>To<\/dt>/g) ?? []).length, 2);
  assert.match(html, /<dd>Acme<\/dd>/);
  assert.match(html, /<dd>Northwind<\/dd>/);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, />Discard</);
});

test("live browser handoffs expose the page name, human action and warning without loading thumbnails", () => {
  const html = renderToStaticMarkup(
    h(LiveBrowserCard, {
      url: "https://example.com",
      title: "Acme sign in",
      status: "Waiting for you",
      statusTone: "warning",
      live: true,
      actionLabel: "Take control",
    }),
  );
  assert.match(html, /aria-label="Acme sign in"/);
  assert.match(html, /Waiting for you/);
  assert.match(html, /apx-livebrowser__status is-warning/);
  assert.match(html, />Take control</);
  assert.match(html, />Live</);
  assert.doesNotMatch(html, /<img/);
});

test("static voice notes disable playback and clamp preview progress while retaining duration", () => {
  const html = renderToStaticMarkup(h(VoiceNote, { duration: 125, progress: 0.25, detail: "42 KB" }));
  assert.match(html, /aria-label="Play"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /width:25%/);
  assert.match(html, /0:31.*2:05/);
  assert.match(renderToStaticMarkup(h(VoiceNote, { duration: 125, progress: 2 })), /width:100%/);
  assert.match(html, /42 KB/);
});

test("system notes render agent mentions as text or actionable chips without changing their names", () => {
  const props = { children: h(AgentChip, { name: "Scout", variant: "plain" }) };
  const plain = renderToStaticMarkup(h(SystemNote, props));
  const action = renderToStaticMarkup(h(AgentChip, { name: "Scout", onClick: () => {} }));
  assert.match(plain, /Scout/);
  assert.doesNotMatch(plain, /<button/);
  assert.match(action, /<button type="button"/);
  assert.match(action, /Scout/);
});
