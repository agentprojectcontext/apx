import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { CatalogEngine } from "@apx/protocol";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const { loadCatalog, models } = await import("./models.ts");
after(() => {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

const engine = (id: string): CatalogEngine => ({
  id,
  kind: "provider",
  label: id,
  available: true,
  models: [{ id: `${id}-1`, name: `${id}-1`, chat: true }],
  starter: `${id}-1`,
});

test("a provider changed while the first catalog is still loading shows up once it lands", async (t) => {
  // The core answers each models.list with the providers it has at that moment; the first answer is slow.
  let engines = [engine("custom")];
  const asked: boolean[] = [];
  let release: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.ok(url.endsWith("/models.list"));
    asked.push(Boolean(JSON.parse(String(init.body)).refresh));
    const now = engines;
    if (asked.length === 1) await slow;
    return Response.json({ ok: true, result: { engines: now } });
  });

  const first = loadCatalog();
  // A provider is added (and switched on and off) while that answer is on its way.
  engines = [engine("custom"), engine("ollama")];
  const second = loadCatalog(true);
  void loadCatalog();
  release();
  await Promise.all([first, second]);

  assert.deepEqual(
    models.get().catalog.map((e) => e.id),
    ["custom", "ollama"],
  );
  assert.equal(models.get().catalogLoad, "ready");
  // One more ask after the first, refreshing as the change asked, not one per call.
  assert.deepEqual(asked, [false, true]);
});
