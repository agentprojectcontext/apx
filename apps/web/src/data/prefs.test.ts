import assert from "node:assert/strict";
import { test } from "node:test";
import { prefs, setPrefs, TEXT_SIZES, textSizeOf } from "./prefs.ts";

test("text size accepts only the device presets", () => {
  for (const size of TEXT_SIZES) assert.equal(textSizeOf(size), size);
  for (const value of [undefined, null, -100, 0, 99, 200, "130", {}, Number.NaN]) assert.equal(textSizeOf(value), 100);
});

test("text size persists without replacing other device preferences and survives blocked storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const before = prefs.get();
  let saved = "";
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: (_key: string, value: string) => {
          saved = value;
        },
      },
    });
    setPrefs({ textSize: 130, font: "mono" });
    assert.equal(prefs.get().textSize, 130);
    assert.equal(JSON.parse(saved).textSize, 130);
    assert.equal(JSON.parse(saved).font, "mono");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage blocked");
      },
    });
    setPrefs({ textSize: 85 });
    assert.equal(prefs.get().textSize, 85);
    assert.equal(prefs.get().font, "mono");
  } finally {
    prefs.set(before);
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
