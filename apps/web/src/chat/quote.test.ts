import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteBlock, quotedIndex, quoteParts, splitQuote } from "./quote.ts";

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

test("a quote does not repeat the name its author already started with", () => {
  assert.equal(quoteBlock("April", "April: Agree."), "> April: Agree.");
  assert.deepEqual(quoteParts("April: April: Agree."), { author: "April", text: "Agree." });
  assert.deepEqual(quoteParts("No author here"), { author: "", text: "No author here" });
});

test("a quote finds the message it came from, the latest one before it", () => {
  const texts = ["Review done.\nTwo notes.", "Other", "Review done.  Two notes. And more", "> Roby: Review done."];
  assert.equal(quotedIndex(texts, 3, "Roby: Review done.\nTwo notes."), 2);
  assert.equal(quotedIndex(texts, 2, "Roby: Review done.\nTwo notes."), 0);
  assert.equal(quotedIndex(texts, 3, "Roby: Review d…"), 2);
  assert.equal(quotedIndex(texts, 3, "Roby: Never said"), -1);
});
