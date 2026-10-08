import assert from "node:assert/strict";
import { test } from "node:test";
import { editMenu } from "./edit-menu.ts";

const flags = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false,
};
const params = {
  isEditable: false,
  selectionText: "",
  editFlags: flags,
  misspelledWord: "",
  dictionarySuggestions: [],
  linkURL: "",
};
const actions = { replaceMisspelling: () => {}, addToDictionary: () => {}, copyText: () => {} };
const labels = (items: ReturnType<typeof editMenu>) => items.map((i) => (i.type === "separator" ? "—" : i.label));

test("a text field gets cut, copy, paste and select all, in the system's language", () => {
  const items = editMenu({ ...params, isEditable: true, selectionText: "hola" }, "es-AR", actions);
  assert.deepEqual(labels(items), ["Cortar", "Copiar", "Pegar", "—", "Seleccionar todo"]);
  assert.ok(items.every((i) => i.type === "separator" || i.enabled));
});

test("an empty field can still paste, but not cut or copy", () => {
  const items = editMenu({ ...params, isEditable: true }, "en-US", actions);
  assert.deepEqual(
    items.filter((i) => i.type !== "separator").map((i) => [i.label, i.enabled]),
    [
      ["Cut", false],
      ["Copy", false],
      ["Paste", true],
      ["Select all", true],
    ],
  );
});

test("selected text outside a field offers copy; nothing to do shows no menu", () => {
  assert.deepEqual(labels(editMenu({ ...params, selectionText: "text" }, "en", actions)), ["Copy"]);
  assert.deepEqual(editMenu(params, "en", actions), []);
});

test("a misspelled word lists its suggestions first, and a link can be copied", () => {
  const replaced: string[] = [];
  const copied: string[] = [];
  const items = editMenu(
    {
      ...params,
      isEditable: true,
      misspelledWord: "busuqemos",
      dictionarySuggestions: ["busquemos"],
      linkURL: "https://example.com",
    },
    "es",
    { ...actions, replaceMisspelling: (w) => replaced.push(w), copyText: (t) => copied.push(t) },
  );
  assert.deepEqual(labels(items), [
    "busquemos",
    "Agregar al diccionario",
    "—",
    "Cortar",
    "Copiar",
    "Pegar",
    "—",
    "Seleccionar todo",
    "—",
    "Copiar enlace",
  ]);
  const click = (i: number) => (items.at(i)?.click as (() => void) | undefined)?.();
  click(0);
  click(-1);
  assert.deepEqual([replaced, copied], [["busquemos"], ["https://example.com"]]);
});
