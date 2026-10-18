import assert from "node:assert/strict";
import { test } from "node:test";
import { readSurfaceMessage, SURFACE_CSP, surfaceDoc } from "./surfaceDoc.ts";

test("a surface gets the strict CSP, the mode's colors and the bridge, wherever its HTML starts", () => {
  const bare = surfaceDoc("<p>hi</p>", { mode: "dark", nonce: "n1" });
  assert.match(bare, /^<!doctype html><html><head>/);
  assert.ok(bare.includes(SURFACE_CSP));
  assert.match(bare, /--apx-bg:#161615/);
  assert.match(bare, /var N="n1"/);
  const full = surfaceDoc("<html><head><title>x</title></head><body></body></html>", { mode: "light", nonce: "n2" });
  assert.match(full, /<head><meta charset="utf-8">/);
  assert.equal(full.match(/<head/g)?.length, 1);
});

test("only this page's prompts, after a real touch, reach the agent", () => {
  const msg = (m: object) => JSON.stringify({ apx: "n1", kind: "prompt", ...m });
  assert.deepEqual(readSurfaceMessage(msg({ text: " add milk ", gesture: true }), "n1"), { prompt: "add milk" });
  assert.equal(readSurfaceMessage(msg({ text: "spam", gesture: false }), "n1"), undefined);
  assert.equal(readSurfaceMessage(msg({ text: "other page", gesture: true }), "n2"), undefined);
  assert.equal(readSurfaceMessage("not json", "n1"), undefined);
});

test("mobile apps fill the viewport while widgets retain their safe inset", () => {
  const app = surfaceDoc('<main class="apx-widget">Example</main>', { mode: "dark", nonce: "n", layout: "app" });
  assert.match(app, /--apx-content-width:none;--apx-page-padding:0px/);
  const widget = surfaceDoc('<main class="apx-widget">Example</main>', { mode: "dark", nonce: "n" });
  assert.match(widget, /--apx-content-width:1100px;--apx-page-padding:clamp/);
});
