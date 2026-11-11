import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf } from "./threads.ts";

test("a mail's preview starts with its subject, without the note on mail read from before", () => {
  assert.equal(previewOf("[subject: Factura]\nTe mando la factura."), "Factura · Te mando la factura.");
  assert.equal(
    previewOf("[historical mail; received: 2026-11-10T22:34:36.000Z]\n[subject: APX on Product Hunt]\nHi there"),
    "APX on Product Hunt · Hi there",
  );
  assert.equal(previewOf("Hola, ¿cómo va?"), "Hola, ¿cómo va?");
});
