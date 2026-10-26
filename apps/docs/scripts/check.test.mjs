import assert from "node:assert/strict";
import test from "node:test";
import { linkErrors, translationErrors } from "./check.mjs";

test("translation pairs require both languages and matching heading levels", () => {
  assert.deepEqual(
    translationErrors(
      new Map([
        ["a.mdx", "## Start"],
        ["es/a.mdx", "## Empezar"],
      ]),
    ),
    [],
  );
  assert.equal(translationErrors(new Map([["a.mdx", "## Start"]])).length, 1);
  assert.equal(translationErrors(new Map([["es/a.mdx", "## Empezar"]])).length, 1);
  assert.equal(
    translationErrors(
      new Map([
        ["a.mdx", "## Start"],
        ["es/a.mdx", "### Empezar"],
      ]),
    ).length,
    1,
  );
});

test("built local links resolve routes, relative URLs and fragment ids under the base", () => {
  const pages = new Map([
    ["/a/", '<a href="/apx/b/#ready">B</a><a href="../b/">B</a><a href="#here">Here</a><div id="here"></div>'],
    ["/b/", '<h2 id="ready">Ready</h2>'],
  ]);
  assert.deepEqual(linkErrors(pages), []);
  pages.set("/a/", '<a href="/apx/b/#missing">B</a><a href="/apx/lost/">Lost</a><a href="/b/">Wrong base</a>');
  assert.equal(linkErrors(pages).length, 3);
});

test("external links and downloads are not reported as missing pages", () => {
  assert.deepEqual(
    linkErrors(
      new Map([
        [
          "/",
          '<a href="https://example.com/">Web</a><a href="mailto:user@example.com">Mail</a><a href="/apx/install.sh">Install</a>',
        ],
      ]),
    ),
    [],
  );
});
