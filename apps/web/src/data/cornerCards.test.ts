import assert from "node:assert/strict";
import { test } from "node:test";

test("launch dismissals are normalized, persisted with other cards, and not reset by another dismissal", async (t) => {
  let saved = JSON.stringify({ discord: true, modelAnnouncements: ["launch-a", "launch-a", 42, null] });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const { closeCard } = await import("./cornerCards.ts");
  closeCard({ star: true });
  assert.deepEqual(JSON.parse(saved).modelAnnouncements, ["launch-a"]);
  closeCard({ modelAnnouncements: ["launch-a", "launch-b"] });
  closeCard({ disk: true });
  const reloaded = JSON.parse(saved);
  assert.deepEqual(reloaded.modelAnnouncements, ["launch-a", "launch-b"]);
  assert.equal(reloaded.discord, true);
  assert.equal(reloaded.star, true);
  assert.equal(reloaded.disk, undefined, "operational warnings remain session-only");
});
