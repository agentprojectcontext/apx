// A routine's Telegram delivery survives a connection that never came up
// (2026-09-23 08:33: the morning summary was produced and lost).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-delivery-retry-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { DELIVERY_ADAPTERS } = await import("#core/routines/delivery.js");
const { CHANNELS } = await import("#core/constants/channels.js");

test("the telegram delivery retries a send that could not connect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const tg = {
    send: async () => {
      calls++;
      if (calls === 1) {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
      }
      return { ok: true };
    },
  };
  const ctx = { plugins: { get: () => tg }, globalConfig: {} };
  const pending = DELIVERY_ADAPTERS[CHANNELS.TELEGRAM].deliver(ctx, { routine: { name: "acme-open" }, text: "Buen día", gate: null });
  // Let the first attempt fail, then release the backoff.
  for (let i = 0; i < 5 && calls < 2; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(10_000); }
  await pending;
  assert.equal(calls, 2);
});
