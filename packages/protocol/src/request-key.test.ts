import assert from "node:assert/strict";
import { test } from "node:test";
import { secureRequestKey } from "./request-key.ts";

test("request keys use secure randomness when randomUUID is unavailable on an HTTP origin", () => {
  const source = { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(bytes) };
  const keys = Array.from({ length: 100 }, () => secureRequestKey(source));
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a client without secure randomness fails explicitly instead of using weak keys", () => {
  assert.throws(
    () => secureRequestKey({ getRandomValues: undefined } as unknown as Parameters<typeof secureRequestKey>[0]),
    /secure request key generator/,
  );
});
