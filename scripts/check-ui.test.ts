import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAllowlist, scanUi, shrinkAllowlist, type UiFinding } from "./check-ui.ts";

const SCREEN = "apps/web/src/acme/Screen.tsx";
const CSS = "apps/web/src/styles/acme.css";
const rules = (file: string, source: string) => scanUi(file, source).map((f) => f.rule);

test("native controls with a design-system component are found", () => {
  assert.deepEqual(rules(SCREEN, "const a = <button onClick={go}>Go</button>;"), ["native-control"]);
  assert.deepEqual(rules(SCREEN, "const a = <select value={v}><option /></select>;"), ["native-control"]);
  assert.deepEqual(rules(SCREEN, "const a = <textarea value={v} />;"), ["native-control"]);
  assert.deepEqual(rules(SCREEN, 'const a = <input type="checkbox" checked />;'), ["native-control"]);
  assert.deepEqual(rules(SCREEN, "const a = <input value={v} />;"), ["native-control"]);
});

test("inputs the design system has no component for, and its own components, pass", () => {
  for (const source of [
    'const a = <input type="file" hidden />;',
    'const a = <input type="range" min={0} />;',
    'const a = <input type="color" value={v} />;',
    "const a = <Button onClick={go}>Go</Button>;",
    "const a = <Select label={l} value={v} options={o} onValueChange={s} />;",
    'const a = <div data-testid="row" role="button" />;',
  ])
    assert.deepEqual(rules(SCREEN, source), [], source);
});

test("literal colours in strings, templates and stylesheets are found", () => {
  assert.deepEqual(rules(SCREEN, 'const a = <rect fill="#fff" />;'), ["literal-color"]);
  assert.deepEqual(rules(SCREEN, 'const a = <div style={{ color: "rgb(0 0 0)" }} />;'), ["literal-color"]);
  assert.deepEqual(rules(SCREEN, "const a = `rgba($[r},0,0,1)`;".replace("$[", "${")), ["literal-color"]);
  assert.deepEqual(rules(CSS, ".a {\n  color: #fff;\n}"), ["literal-color"]);
  assert.deepEqual(rules(CSS, ".a {\n  color: var(--apx-danger, #f85149);\n}"), ["literal-color"]);
  assert.deepEqual(
    scanUi(CSS, ".a {\n  padding: 0;\n  background: hsl(0 0% 0%);\n}").map((f) => f.line),
    [3],
  );
});

test("tokens, masks, comments and marked exceptions pass", () => {
  for (const source of [
    ".a { color: var(--apx-fg); box-shadow: var(--apx-shadow-md); }",
    ".a { background: color-mix(in srgb, var(--apx-brand) 14%, transparent); }",
    ".a { mask-image: linear-gradient(to bottom, #000 75%, transparent); }",
    "/* was #fff */ .a { color: var(--apx-fg); }",
    ".a { background: #fff; /* ui: an outside page is drawn on white */ }",
  ])
    assert.deepEqual(rules(CSS, source), [], source);
  assert.deepEqual(rules(SCREEN, 'const QR = { light: "#fff" }; // ui: scanned dark on light'), []);
  assert.deepEqual(rules(SCREEN, '// ui: a value for the colour input\nconst c = "#000000";'), []);
});

test("tests, the design system and other apps are out of scope", () => {
  assert.deepEqual(rules("apps/web/src/acme/Screen.test.tsx", "const a = <button />;"), []);
  assert.deepEqual(rules("packages/ui/src/components/Button.tsx", "const a = <button />;"), []);
  assert.deepEqual(rules("apps/desktop/src/renderer/x.tsx", "const a = <button />;"), []);
});

test("the allowlist fails on a new hit and on an allowance no longer needed, and shrinks", () => {
  const hit = (file: string): UiFinding => ({ file, line: 1, rule: "native-control", reason: "" });
  const allow = { "native-control": { "a.tsx": { count: 2, reason: "rows" }, "b.tsx": { count: 1, reason: "x" } } };
  const { extra, stale } = checkAllowlist([hit("a.tsx"), hit("c.tsx")], allow);
  assert.deepEqual(
    extra.map((f) => f.file),
    ["c.tsx"],
  );
  assert.deepEqual(stale, ["a.tsx: native-control allows 2, found 1", "b.tsx: native-control allows 1, found 0"]);
  assert.deepEqual(shrinkAllowlist(allow, [hit("a.tsx")]), {
    "native-control": { "a.tsx": { count: 1, reason: "rows" } },
  });
});
