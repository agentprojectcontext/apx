import assert from "node:assert/strict";
import { test } from "node:test";
import { connectExtension } from "./connecting.ts";

const extension = { id: "example", enabled: false, mcp: ["example-server"] };

function fixture(enabled = false) {
  let current = { ...extension, enabled };
  const calls: boolean[] = [];
  const published: boolean[] = [];
  return {
    get current() {
      return current;
    },
    calls,
    published,
    enable: async (_id: string, on: boolean) => {
      calls.push(on);
      current = { ...current, enabled: on };
      return current;
    },
    changed: (updated: typeof extension) => {
      published.push(updated.enabled);
    },
  };
}

test("failed first connection turns the extension off and publishes the retryable state", async () => {
  const f = fixture();
  const failure = new Error("Package missing from cache");
  await assert.rejects(
    connectExtension(f.current, {
      ...f,
      start: async (servers) => {
        assert.deepEqual(servers, extension.mcp);
        assert.deepEqual(f.published, []);
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(f.current.enabled, false);
  assert.deepEqual(f.calls, [true, false]);
  assert.deepEqual(f.published, [false]);
  const result = await connectExtension(f.current, { ...f, start: async () => ["find"] });
  assert.deepEqual(result.tools, ["find"]);
  assert.equal(f.current.enabled, true);
  assert.deepEqual(f.published, [false, true]);
});

test("a successful first connection is published only after tools become ready", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<string[]>();
  const entered = Promise.withResolvers<void>();
  const pending = connectExtension(f.current, {
    ...f,
    start: async () => {
      entered.resolve();
      return ready.promise;
    },
  });
  await entered.promise;
  assert.deepEqual(f.published, []);
  ready.resolve(["read"]);
  assert.deepEqual((await pending).tools, ["read"]);
  assert.deepEqual(f.published, [true]);
});

test("failure never disables an extension that was already connected", async () => {
  const f = fixture(true);
  await assert.rejects(
    connectExtension(f.current, {
      ...f,
      start: async () => {
        throw new Error("Unavailable");
      },
    }),
    /Unavailable/,
  );
  assert.equal(f.current.enabled, true);
  assert.deepEqual(f.calls, []);
});

test("an enable refusal does not trigger a compensating disable", async () => {
  const f = fixture();
  await assert.rejects(
    connectExtension(f.current, {
      ...f,
      enable: async () => {
        throw new Error("Approval required");
      },
      start: async () => assert.fail("Must not start"),
    }),
    /Approval required/,
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.published, []);
});

test("rollback failures remain visible rather than claiming the extension is off", async () => {
  const f = fixture();
  await assert.rejects(
    connectExtension(f.current, {
      ...f,
      enable: async (id, on) => {
        if (!on) throw new Error("Offline");
        return f.enable(id, on);
      },
      start: async () => {
        throw new Error("Unavailable");
      },
    }),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(f.current.enabled, true);
  assert.deepEqual(f.published, []);
});
