import assert from "node:assert/strict";
import { test } from "node:test";
import { widgetScriptError } from "./widget-syntax.ts";

const check = (html: string, tool: "show_widget" | "edit_widget" = "show_widget") => widgetScriptError(html, tool);

test("a script inside a comment or a template is not checked, and lines stay relative to the whole HTML", async () => {
  const html = [
    "<!--",
    "<script>let = ;</script>",
    "-->",
    "<template>\n<script>let = ;</script>\n</template>",
    "<script>",
    "const a = {",
    "  x: 1",
    "  y: 2 };",
    "</script>",
  ].join("\n");
  assert.match((await check(html)) ?? "", /line 10 \(column 3\) of the widget does not parse/);
  assert.equal(await check("<!-- <script>let = ;</script> --><template><script>let = ;</script></template>"), null);
});

test("a script that mentions a comment in a string is still checked as a whole", async () => {
  assert.equal(await check('<script>const s = "<!-- not a comment";</script><p>-->'), null);
  assert.match((await check('<script>const s = "<!-- x";\nlet = ;</script>')) ?? "", /line 2 /);
});

test("data-type and data-src do not decide a script's kind", async () => {
  assert.match((await check('<script data-type="json">let = ;</script>')) ?? "", /does not parse/);
  assert.match((await check('<script data-src="a.js">let = ;</script>')) ?? "", /does not parse/);
  assert.equal(await check('<script type="application/json" data-type="module">{"a": 1 "b"}</script>'), null);
  assert.equal(await check('<script src="a.js"></script>'), null);
});

test("the refusal names the tool that was called, for classic and module scripts", async () => {
  assert.match((await check("<script>let = ;</script>", "edit_widget")) ?? "", /call edit_widget again/);
  const mod = await check(
    '<p></p>\n<script type="module">\nimport a from "./a.js";\nconst b = {\n x: 1\n y: 2};</script>',
  );
  assert.match(mod ?? "", /line 6 \(column 2\).*call show_widget again/);
});

test("several module scripts are checked together and the first broken one in the page is reported", async () => {
  const ok = '<script type="module">export const a = 1;</script>\n';
  const html = `${ok}${ok}<script type="module">\nlet = ;</script>\n<script type="module">let x = ;</script>`;
  assert.match((await check(html)) ?? "", /line 4 /);
});

test("a stopped turn ends the module check without failing the widget", async () => {
  const stopped = AbortSignal.abort();
  assert.equal(await widgetScriptError('<script type="module">let = ;</script>', "show_widget", stopped), null);
});
