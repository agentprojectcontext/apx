import assert from "node:assert/strict";
import { test } from "node:test";
import { enComputer } from "./computer-en.ts";
import { esComputer } from "./computer-es.ts";
import { en as base } from "./en.ts";
import { es as esBase } from "./es.ts";

// A pack's strings belong to the language as much as the main chunk's.
const en = { ...base, ...enComputer };
const es = { ...esBase, ...esComputer };

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
