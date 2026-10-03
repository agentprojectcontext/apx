import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./en.ts";
import { es } from "./es.ts";

// Each language is loaded alone, so a key it lacks would show as the bare key.
test("every English text has its Spanish translation", () => {
  const missing = Object.keys(en).filter((k) => (es as Record<string, string | undefined>)[k] === undefined);
  assert.deepEqual(missing, []);
});

test("a translation keeps the placeholders of its English text", () => {
  const tr = es as Record<string, string | undefined>;
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const wrong = Object.entries(en).filter(
    ([k, v]) => tr[k] !== undefined && vars(tr[k] ?? "").join() !== vars(v).join(),
  );
  assert.deepEqual(
    wrong.map(([k]) => k),
    [],
  );
});
