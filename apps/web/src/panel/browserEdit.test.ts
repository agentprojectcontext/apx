import assert from "node:assert/strict";
import { test } from "node:test";
import type { PickedElement } from "@apx/protocol";
import { enBrowserEdit } from "../i18n/browser-edit-en.ts";
import type { T } from "../i18n/index.ts";
import {
  browserEdit,
  changeItem,
  type EditItem,
  editRequest,
  editsOf,
  hexOf,
  isChanged,
  pageHeader,
  pick,
  select,
  startEditing,
} from "./browserEdit.ts";

const t: T = (key, vars) =>
  (enBrowserEdit as Record<string, string>)[key]?.replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n])) ?? key;

const element = (over: Partial<PickedElement>): PickedElement => ({
  node: 1,
  tag: "a",
  role: "link",
  name: "Book a demo",
  selector: "a.cta",
  text: "Book a demo",
  sensitive: false,
  box: null,
  style: {},
  ...over,
});

test("the request reads plainly: the page, each changed part by its words and only what changed", () => {
  const items: EditItem[] = [
    {
      element: element({}),
      text: "Get your demo",
      style: { color: "#3b6cff", font_size: 17 },
      note: " Bigger\n please ",
    },
    {
      element: element({ node: 2, tag: "h1", name: "", text: "A long title", selector: "h1#hero" }),
      style: {},
      note: "Shorter",
    },
    { element: element({ node: 3, selector: "p" }), text: "Book a demo", style: {}, note: "" },
  ];
  assert.equal(
    editRequest(pageHeader("http://localhost:5173/", t), items, t),
    [
      "Changes to localhost:5173:",
      "- «Book a demo»: make it say «Get your demo»; text color #3b6cff; font size 17 px; Bigger please",
      "- «A long title»: Shorter",
    ].join("\n"),
  );
  assert.equal(isChanged(items[2] as EditItem), false);
});

test("the page is shown only text and style changes, never the notes", () => {
  const items: EditItem[] = [
    { element: element({}), text: "Book a demo", style: { padding: undefined }, note: "note only" },
    { element: element({ node: 2 }), text: "New", style: { background: "#000000" }, note: "" },
  ];
  assert.deepEqual(editsOf(items), [{ node: 2, text: "New", style: { background: "#000000" } }]);
});

test("a page color becomes a color input's hex", () => {
  assert.equal(hexOf("rgb(226, 85, 47)"), "#e2552f");
  assert.equal(hexOf("rgba(0, 0, 0, 0)"), "#000000");
  assert.equal(hexOf("#ABCDEF"), "#abcdef");
  assert.equal(hexOf(undefined), "#000000");
});

test("one part is edited at a time: picking another drops the one before unless it was changed", () => {
  startEditing("tab-1");
  pick(element({ node: 1 }));
  pick(element({ node: 2 }));
  assert.deepEqual(
    browserEdit.get().items.map((i) => i.element.node),
    [2],
  );
  changeItem(2, { text: "Changed" });
  pick(element({ node: 3 }));
  pick(element({ node: 4 }));
  assert.deepEqual(
    browserEdit.get().items.map((i) => i.element.node),
    [2, 4],
  );
  select(2);
  assert.deepEqual(
    browserEdit.get().items.map((i) => i.element.node),
    [2],
  );
  assert.equal(browserEdit.get().selected, 2);
});
