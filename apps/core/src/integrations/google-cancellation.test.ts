import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { setup } from "./google-testkit.ts";
import { sheetsApi } from "./sheets.ts";

test("cancelling Sheets during OAuth refresh aborts the refresh and never sends a write", async () => {
  let entered = false;
  const release = Promise.withResolvers<void>();
  let paused = false;
  let aborted = false;
  const env = setup({
    wrapFetch: (base) => async (input, init) => {
      if (paused && String(input).endsWith("/token")) {
        const signal = init?.signal;
        const cancel = Promise.withResolvers<never>();
        const onAbort = () => {
          aborted = true;
          cancel.reject(new Error("cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        entered = true;
        try {
          await Promise.race([release.promise, cancel.promise]);
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      }
      init?.signal?.throwIfAborted();
      return base(input, init);
    },
  });
  await env.g.finish("good-code", env.start("google-drive").searchParams.get("state") ?? "");
  env.tick(3_600_000);
  paused = true;
  const before = env.fake.seen.length;
  const controller = new AbortController();
  const pending = assert.rejects(
    sheetsApi(env.g).write({ id: "sheet-1", range: "Sheet1!A1", values: [[1]] }, controller.signal),
    /cancelled/,
  );
  try {
    await waitFor(() => entered, "the refresh request");
    controller.abort();
    assert.equal(aborted, true, "the token request must observe cancellation immediately");
  } finally {
    release.resolve();
    await pending;
  }
  assert.equal(env.fake.seen.length, before, "no refresh or API write completes after cancellation");
});
