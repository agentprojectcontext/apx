import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApxProvider,
  Badge,
  Button,
  Calendar,
  dayString,
  EmptyState,
  Field,
  type FieldProps,
  IconButton,
  Input,
  MarkdownView,
  Spinner,
  StepList,
  useApx,
  withMentions,
} from "../dist/index.js";
import { keyed } from "../src/keys.ts";

test("loading buttons prevent duplicate submission, keep their label and replace the leading icon", () => {
  const html = renderToStaticMarkup(
    createElement(
      Button,
      {
        loading: true,
        size: "lg",
        type: "submit",
        leadingIcon: "Before",
        trailingIcon: "After",
      },
      "Save",
    ),
  );
  assert.match(html, /type="submit"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /width="16"/);
  assert.match(html, /Save/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /Before/);
  const idle = renderToStaticMarkup(createElement(Button, { leadingIcon: "Before" }, "Save"));
  assert.match(idle, /type="button"/);
  assert.match(idle, /Before/);
  assert.doesNotMatch(idle, /disabled|aria-busy/);
});

test("icon controls expose their accessible name, toggle state and explicit disabled state", () => {
  const html = renderToStaticMarkup(
    createElement(IconButton, { label: "Open files", icon: "+", active: true, disabled: true, tooltip: false }),
  );
  assert.match(html, /aria-label="Open files"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /disabled=""/);
});

test("form labels point at generated control ids and errors replace hints", () => {
  const field: FieldProps = {
    label: "Project name",
    hint: "Optional",
    error: "Required",
    children: (id: string) => createElement(Input, { id, invalid: true, disabled: true }),
  };
  const html = renderToStaticMarkup(createElement(Field, field));
  const id = /<label[^>]+for="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, html);
  assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Required/);
  assert.doesNotMatch(html, /Optional/);
});

test("spinners announce progress only when labelled; badge dots remain decorative", () => {
  const labelled = renderToStaticMarkup(createElement(Spinner, { label: "Loading" }));
  assert.match(labelled, /role="status"/);
  assert.match(labelled, /aria-label="Loading"/);
  assert.doesNotMatch(labelled, /aria-hidden/);
  assert.match(renderToStaticMarkup(createElement(Spinner)), /aria-hidden="true"/);
  const badge = renderToStaticMarkup(createElement(Badge, { dot: true, tone: "danger" }, "Offline"));
  assert.match(badge, /apx-tone--danger/);
  assert.match(badge, /aria-hidden="true"/);
  assert.match(badge, /Offline/);
});

test("empty states preserve actionable recovery and escape outside text", () => {
  const html = renderToStaticMarkup(
    createElement(
      EmptyState,
      {
        title: "<script>bad()</script>",
        action: createElement(Button, {}, "Retry"),
      },
      "No connection",
    ),
  );
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /No connection/);
  assert.match(html, />Retry</);
  assert.doesNotMatch(html, /<script>/);
});

test("Markdown renders structure and code, escapes HTML and refuses executable links", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      source:
        '# Acme\n\n**Strong** and *emphasis*\n\n- One\n- Two\n\n> Quoted\n\n```ts\nconst x = "<tag>";\n```\n\n<script>bad()</script>\n\n[Unsafe](javascript:alert) [Safe](https://example.com)\n\n| Name | Count |\n| --- | ---: |\n| Acme | 2 |',
    }),
  );
  for (const part of [
    "<h3",
    "<strong>Strong</strong>",
    "<em>emphasis</em>",
    "<ul",
    "<blockquote",
    "<pre",
    "<table",
    'href="https://example.com"',
    'rel="noopener noreferrer"',
  ])
    assert.ok(html.includes(part), part);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;tag&gt;/);
});

test("Markdown custom renderers receive code, quote, inline code and app links without enabling unsafe schemes", () => {
  const seen: string[] = [];
  const wrap = (name: string, node: ReactNode) => {
    seen.push(name);
    return node;
  };
  renderToStaticMarkup(
    createElement(MarkdownView, {
      source: "[Settings](apx:settings/desktop)\n\n> Quote\n\n```JS\nlet x = 1;\n```\n\n`thr_1`",
      renderLink: (href: string, node: ReactElement) => wrap(href, node),
      renderQuote: (node: ReactElement) => wrap("quote", node),
      renderCode: (code: string, lang: string | undefined, node: ReactElement) => wrap(`${lang}:${code}`, node),
      renderCodeSpan: (text: string, node: ReactElement) => wrap(text, node),
    }),
  );
  assert.deepEqual(seen.sort(), ["apx:settings/desktop", "js:let x = 1;", "quote", "thr_1"].sort());
});

test("mentions do not turn emails or embedded names into badges and preserve every character", () => {
  const html = renderToStaticMarkup(
    createElement("p", {}, ...withMentions("Ask @scout, user@example.com, word@vera, @@no; @Álvaro-2")),
  );
  assert.equal((html.match(/class="apx-mention"/g) ?? []).length, 2);
  assert.match(html, />@scout<\/span>/);
  assert.match(html, />@Álvaro-2<\/span>/);
  assert.match(html, /user@example.com, word@vera, @@no/);
});

test("list keys distinguish duplicate text and keep unaffected items stable after insertion", () => {
  const items = ["Acme", "Northwind", "Acme"];
  assert.deepEqual(
    keyed(items, (x) => x).map((x) => x.key),
    ["Acme:0", "Northwind:0", "Acme:1"],
  );
  assert.deepEqual(
    keyed(["New", ...items], (x) => x)
      .slice(1)
      .map((x) => x.key),
    ["Acme:0", "Northwind:0", "Acme:1"],
  );
  assert.deepEqual(
    keyed([createElement("span", { key: "id" }), null, 7], (x) => x).map((x) => x.key),
    ["#id:0", ":0", "7:0"],
  );
});

test("step lists expose pending, working, failed and completed outcomes, including repeated labels", () => {
  const html = renderToStaticMarkup(
    createElement(StepList, {
      steps: [
        { label: "Acme", detail: "Saved" },
        { label: "Acme", status: "failed", detail: "Refused" },
        { label: "Northwind", status: "running" },
        { label: "Later", status: "pending" },
      ],
    }),
  );
  for (const state of ["done", "failed", "running", "pending"]) assert.ok(html.includes(`is-${state}`));
  assert.match(html, /Saved/);
  assert.match(html, /Refused/);
  assert.equal((html.match(/<li /g) ?? []).length, 4);
});

test("calendar supports leap days and selected dates without UTC shifting local day strings", () => {
  assert.equal(dayString(new Date(2024, 1, 29, 23, 30)), "2024-02-29");
  const html = renderToStaticMarkup(
    createElement(Calendar, { selected: "2024-02-29", onPick: () => {}, min: "2024-02-20", locale: "en-US" }),
  );
  assert.match(html, /February 2024/);
  assert.match(html, /is-selected/);
  assert.match(html, /disabled=""/);
  assert.match(html, />29</);
});

test("theme context follows the nearest provider and has usable defaults outside a provider", () => {
  const View = () => {
    const { look, mode } = useApx();
    return createElement("span", {}, `${look}/${mode}`);
  };
  assert.equal(renderToStaticMarkup(createElement(View)), "<span>minimal/light</span>");
  const html = renderToStaticMarkup(
    createElement(ApxProvider, { look: "classic", mode: "dark", fill: true }, createElement(View)),
  );
  assert.match(html, /data-apx-look="classic"/);
  assert.match(html, /data-apx-mode="dark"/);
  assert.match(html, />classic\/dark</);
  assert.match(html, /apx-portal/);
});
