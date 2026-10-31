import assert from "node:assert/strict";
import { test } from "node:test";
import { cardLine } from "./input-words.ts";

test("an answered card folds into its first sentence, not the tool's name", () => {
  assert.equal(
    cardLine("Prender «Leads · web». Desde ahora corre como está dibujado.\nCada vez:\n• Te manda un mensaje"),
    "Prender «Leads · web»",
  );
  assert.equal(cardLine("Probar «Leads» ahora. Corre de verdad: manda y llama."), "Probar «Leads» ahora");
  assert.equal(cardLine("Change the contact Ana: role → client"), "Change the contact Ana");
});
