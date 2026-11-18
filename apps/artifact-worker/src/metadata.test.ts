import assert from "node:assert/strict";
import { test } from "node:test";
import { metadataCloud } from "./metadata.ts";

function deadlines() {
  let pending: (() => void) | undefined;
  let canceled = 0;
  return {
    after(ms: number, notify: () => void) {
      assert.equal(ms, 8000);
      pending = notify;
      return () => {
        pending = undefined;
        canceled++;
      };
    },
    expire() {
      assert.ok(pending);
      pending();
    },
    pending: () => Boolean(pending),
    canceled: () => canceled,
  };
}
const session = { uid: "person", idToken: "fixture-token" };

test("metadata deadlines are canceled after success, refusal and malformed JSON so the account can hibernate", async () => {
  for (const item of [
    { response: Response.json({ documents: [] }) },
    { response: new Response(null, { status: 403 }), error: /access_denied/ },
    { response: new Response("not json"), error: /JSON/ },
  ]) {
    const timers = deadlines();
    const api = metadataCloud(session, {
      project: "demo-apx-artifacts",
      after: timers.after,
      fetch: async () => item.response,
    });
    if (item.error) await assert.rejects(api.slots(), item.error);
    else assert.deepEqual(await api.slots(), []);
    assert.equal(timers.pending(), false);
    assert.equal(timers.canceled(), 1);
  }
});

test("an injected metadata deadline aborts the actual transport and clears its timer without a real-time race", async () => {
  const timers = deadlines();
  let signal: AbortSignal | null | undefined;
  const api = metadataCloud(session, {
    project: "demo-apx-artifacts",
    after: timers.after,
    fetch: async (_input, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  const reading = api.slots();
  timers.expire();
  await assert.rejects(reading, /aborted/);
  assert.equal(signal?.aborted, true);
  assert.equal(timers.pending(), false);
  assert.equal(timers.canceled(), 1);
});
