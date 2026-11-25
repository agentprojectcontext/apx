import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf } from "./threads.ts";

test("sticker previews retain the meaning and caption without internal envelopes", () => {
  const wrapped = '<sticker named_by="a model that saw it" trust="untrusted">\n[sticker (18+): fox]\n</sticker>';
  assert.equal(previewOf(wrapped), "[sticker (18+): fox]");
  assert.equal(previewOf(`Hello\n${wrapped}`), "Hello\n[sticker (18+): fox]");
  const long = wrapped.replace("fox", "x".repeat(200));
  assert.equal(previewOf(long), `[sticker (18+): ${"x".repeat(200)}]`.slice(0, 160));
});

test("a mail's preview starts with its subject, without the note on mail read from before", () => {
  assert.equal(previewOf("[subject: Factura]\nTe mando la factura."), "Factura · Te mando la factura.");
  assert.equal(
    previewOf("[historical mail; received: 2026-11-10T22:34:36.000Z]\n[subject: APX on Product Hunt]\nHi there"),
    "APX on Product Hunt · Hi there",
  );
  assert.equal(previewOf("Hola, ¿cómo va?"), "Hola, ¿cómo va?");
});
