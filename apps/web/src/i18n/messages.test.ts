import assert from "node:assert/strict";
import { test } from "node:test";
import { en, LANGUAGES } from "./messages.ts";

// Brand names read the same in every language.
const SAME_EVERYWHERE = /^channel\.[a-z]+\.name$/;

test("every English text has its Spanish translation", () => {
  const es = LANGUAGES.es as Record<string, string | undefined>;
  const missing = Object.keys(en).filter((k) => es[k] === undefined && !SAME_EVERYWHERE.test(k));
  assert.deepEqual(missing, []);
});

test("a translation keeps the placeholders of its English text", () => {
  const es = LANGUAGES.es as Record<string, string | undefined>;
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const wrong = Object.entries(en).filter(
    ([k, v]) => es[k] !== undefined && vars(es[k] ?? "").join() !== vars(v).join(),
  );
  assert.deepEqual(
    wrong.map(([k]) => k),
    [],
  );
});
