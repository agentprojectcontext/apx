import assert from "node:assert/strict";
import { test } from "node:test";
import { soFar } from "./so-far.ts";

test("a report's markdown reaches the notice as plain text", () => {
  assert.equal(
    soFar("**Resumen**\n- Diseñé la *pantalla* de `chats`\n- Armé el [prototipo](https://example.com/p)\n\n---\n"),
    "Resumen. Diseñé la pantalla de chats. Armé el prototipo",
  );
  assert.equal(soFar("## Hecho:\n1. Primero\n2. Segundo"), "Hecho: Primero. Segundo");
  assert.equal(soFar("Antes\n```ts\nconst x = 1;\n```\nDespués"), "Antes. Después");
});

test("a long report is cut at a sentence end, or else at a word with an ellipsis", () => {
  const sentences = `${"Armé la vista de lista. ".repeat(6)}Falta la de detalle`;
  const cut = soFar(sentences, 100);
  assert.ok(cut.length <= 100);
  assert.match(cut, /lista\.$/);
  const words = soFar(`${"palabra ".repeat(40)}`, 50);
  assert.ok(words.length <= 51);
  assert.match(words, /palabra…$/);
  assert.equal(soFar("corto"), "corto");
});
