import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteBlock, splitQuote } from "./quote.ts";

test("a quote names its author on the first line and marks every line", () => {
  assert.equal(quoteBlock("Roby", "Review done.\nTwo notes."), "> Roby: Review done.\n> Two notes.");
  assert.equal(quoteBlock("", "  Plain  "), "> Plain");
});

test("a long quote is cut", () => {
  assert.equal(quoteBlock("Roby", "abcdefghij", 4), "> Roby: abcd…");
});

test("a reply's leading quote is told apart from what it says", () => {
  assert.deepEqual(splitQuote("> Roby: Review done.\n> Two notes.\n\n@roby why?"), {
    quote: "Roby: Review done.\nTwo notes.",
    rest: "@roby why?",
  });
  assert.deepEqual(splitQuote("No quote > here"), { quote: "", rest: "No quote > here" });
});
