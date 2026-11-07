import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { translator } from "./index.ts";

test("a count of one reads in the singular in both languages", () => {
  for (const [lang, one, many] of [
    ["en", "1 execution", "3 executions"],
    ["es", "1 ejecución", "3 ejecuciones"],
  ] as const) {
    const t = translator(lang);
    assert.equal(t("routineRuns", { n: 1 }), one);
    assert.equal(t("routineRuns", { n: 3 }), many);
    assert.notEqual(t("routineRuns", { n: 0 }), one);
  }
  assert.equal(translator("en")("memCount", { n: 1 }), "1 note");
  assert.equal(translator("es")("unreadChats", { n: 1 }), "1 chat con mensajes sin leer");
});

test("both languages have the same singulars", () => {
  const ones = (dict: Record<string, string>) => Object.keys(dict).filter((key) => key.endsWith("One"));
  assert.deepEqual(ones(es).sort(), ones(en).sort());
});
