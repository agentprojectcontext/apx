import assert from "node:assert/strict";
import { test } from "node:test";
import { slugOf } from "./slug.ts";

test("an agent's file name comes from its name: no accents, spaces or a leading digit", () => {
  assert.equal(slugOf("María José"), "maria-jose");
  assert.equal(slugOf("  CFO / Finanzas "), "cfo-finanzas");
  assert.equal(slugOf("3D Artist"), "d-artist");
  assert.equal(slugOf("¿?"), "");
});
