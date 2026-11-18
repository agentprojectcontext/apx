import assert from "node:assert/strict";
import { test } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { chargeBudget } from "./budget.ts";
import { mutate } from "./mutations.ts";
import { recoverPending, sweepUncertainCopy } from "./recovery.ts";
import { type Bucket, pointer, pointerKey } from "./storage.ts";

const code = "abcd1234";
async function fixture() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({ modules: true, script: "export default {}", r2Buckets: ["COPIES"] }),
  );
  const r2 = await mf.getR2Bucket("COPIES");
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown) {
      values.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return values.delete(key);
    },
  };
  let pending: Parameters<Parameters<typeof mutate>[1]["rememberPending"]>[0] | undefined;
  let failPointer: "before" | "after" | undefined;
  let failBody: "before" | "after" | undefined;
  let failDelete: string | undefined;
  let slot = false;
  let revoked = false;
  const uncertain = new Set<string>();
  const bucket: Bucket = {
    async get(key) {
      const result = await r2.get(key);
      if (!result) return null;
      const bytes = await result.arrayBuffer();
      const body = new Response(bytes).body;
      assert.ok(body);
      return { body, json: <T>() => new Response(bytes).json<T>() };
    },
    async put(key, value) {
      await chargeBudget(storage, { op: "write", key, bytes: new TextEncoder().encode(value).length }, 0);
      const kind = key === pointerKey(code) ? "pointer" : "body";
      const failure = kind === "pointer" ? failPointer : failBody;
      if (kind === "pointer") failPointer = undefined;
      else failBody = undefined;
      if (failure === "before") throw new Error(`${kind}_write_failed`);
      await r2.put(key, value);
      if (failure === "after") throw new Error(`${kind}_response_lost`);
    },
    async delete(key) {
      if (key === failDelete) throw new Error("body_delete_failed");
      await r2.delete(key);
      await chargeBudget(storage, { op: "release", key }, 0);
    },
  };
  const cloud = {
    async available() {
      return !slot;
    },
    async get() {
      return { name: "publicArtifacts/abcd1234", fields: {}, updateTime: "one" };
    },
    async slots() {
      return slot
        ? [{ name: "artifactAccounts/person/slots/0", fields: { code: { stringValue: code } }, updateTime: "one" }]
        : [];
    },
    async reserve() {
      slot = true;
      return "0";
    },
    async release() {
      slot = false;
    },
  };
  const rememberPending: Parameters<typeof mutate>[1]["rememberPending"] = async (value) => {
    pending = structuredClone(value);
  };
  return {
    bucket,
    cloud,
    storage,
    values,
    r2,
    mf,
    pending: () => pending,
    rememberPending,
    uncertain,
    clearPending: () => {
      pending = undefined;
    },
    async recover() {
      if (!pending) return;
      await recoverPending(code, pending, {
        bucket,
        cloud,
        session: { uid: "person", idToken: "local" },
        rememberPending,
        rememberUncertain: async (hash) => {
          uncertain.add(hash);
        },
        rawDelete: (key) => r2.delete(key),
        revoked,
      });
      pending = undefined;
    },
    failPointer(mode: typeof failPointer) {
      failPointer = mode;
    },
    failBody(mode: typeof failBody) {
      failBody = mode;
    },
    failDelete(key?: string) {
      failDelete = key;
    },
    async send(action: "publish" | "update" | "revoke", html = "Revision A") {
      const previous = await pointer(bucket, code);
      return mutate(
        new Request("https://example.com/", {
          method: "POST",
          headers: { "x-artifact-revision": previous?.meta.revision ?? "" },
          body: JSON.stringify({
            format: "apx-artifact@1",
            manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
            html,
          }),
        }),
        {
          bucket,
          cloud,
          code,
          action,
          session: { uid: "person", idToken: "local" },
          rememberPending,
          rememberRevocation: async () => {
            revoked = true;
          },
        },
      );
    },
  };
}

for (const mode of ["exact limit", "oversized stream", "oversized declared length"] as const) {
  test(`publication size boundary: ${mode} never stores a partial copy`, async () => {
    const f = await fixture();
    try {
      const bundle = {
        format: "apx-artifact@1",
        manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
        html: "<h1>Orders</h1>",
        state: { video: "" },
      };
      const overhead = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
      bundle.state.video = "x".repeat(10_000_000 - overhead + (mode === "oversized stream" ? 1 : 0));
      let reservations = 0;
      const reserve = f.cloud.reserve;
      f.cloud.reserve = async () => {
        reservations++;
        return reserve();
      };
      const request = new Request("https://example.com/", {
        method: "POST",
        body: mode === "oversized declared length" ? "{}" : JSON.stringify(bundle),
        ...(mode === "oversized declared length" ? { headers: { "content-length": "10000001" } } : {}),
      });
      const result = mutate(request, {
        bucket: f.bucket,
        cloud: f.cloud,
        code,
        action: "publish",
        session: { uid: "person", idToken: "local" },
        rememberPending: f.rememberPending,
        rememberRevocation: async () => {},
      });
      if (mode === "exact limit") {
        assert.equal((await result).code, code);
        assert.equal((await pointer(f.bucket, code))?.meta.bytes, 10_000_000);
        assert.equal((await f.r2.list()).objects.length, 2);
        assert.equal(reservations, 1);
      } else {
        await assert.rejects(result, /public_artifact_too_large/);
        assert.equal((await f.r2.list()).objects.length, 0);
        assert.equal(reservations, 0);
        assert.equal(f.pending(), undefined);
        assert.equal(f.values.size, 0);
      }
    } finally {
      await f.mf.dispose();
    }
  });
}

for (const failure of ["lost pointer response", "failed old body delete"] as const) {
  test(`recovery keeps the committed revision after ${failure} and releases obsolete reservations`, async () => {
    const f = await fixture();
    try {
      await f.send("publish");
      await f.recover();
      const first = await pointer(f.bucket, code);
      assert.ok(first);
      if (failure === "lost pointer response") {
        f.failPointer("after");
        await assert.rejects(f.send("update", "Revision B"), /pointer_response_lost/);
      } else {
        await f.send("update", "Revision B");
        f.failDelete(`copies/${code}/${first.meta.sha256}`);
        await assert.rejects(f.recover(), /body_delete_failed/);
        assert.ok(f.pending(), "failed cleanup must retain both hashes");
        f.failDelete();
      }
      const current = await pointer(f.bucket, code);
      assert.ok(current);
      assert.notEqual(current.meta.sha256, first.meta.sha256);
      assert.equal((await f.r2.list({ prefix: `copies/${code}/` })).objects.length, 2);
      await f.recover();
      assert.deepEqual(
        (await f.r2.list({ prefix: `copies/${code}/` })).objects.map((item) => item.key),
        [`copies/${code}/${current.meta.sha256}`],
      );
      assert.equal([...f.values.keys()].filter((key) => key.startsWith("object/copies/")).length, 1);
      assert.equal(f.pending(), undefined);
      await f.send("revoke");
      assert.equal((await f.r2.list()).objects.length, 0);
      assert.equal((await f.storage.get<{ bytes: number }>("totals"))?.bytes, 0);
    } finally {
      await f.mf.dispose();
    }
  });
}

for (const failure of ["before", "after"] as const) {
  test(`revocation reclaims both bodies after an update pointer failure ${failure} commit`, async () => {
    const f = await fixture();
    try {
      await f.send("publish");
      await f.recover();
      f.failPointer(failure);
      await assert.rejects(f.send("update", "Revision B"), /pointer_/);
      const delayed = await (await f.r2.get(pointerKey(code)))?.text();
      assert.ok(delayed);
      await f.send("revoke");
      await f.r2.put(pointerKey(code), delayed);
      await f.recover();
      assert.equal((await f.r2.list()).objects.length, 0);
      assert.equal((await f.storage.get<{ bytes: number }>("totals"))?.bytes, 0);
      assert.equal(f.pending(), undefined);
    } finally {
      await f.mf.dispose();
    }
  });
}

test("recovery cannot delete another account's body through an unclaimed publication journal", async () => {
  const f = await fixture();
  try {
    await f.send("publish");
    await f.recover();
    const current = await pointer(f.bucket, code);
    assert.ok(current);
    await recoverPending(
      code,
      { sha256: current.meta.sha256, owned: false, acknowledged: false },
      {
        bucket: f.bucket,
        cloud: f.cloud,
        session: { uid: "other", idToken: "local" },
        rememberPending: f.rememberPending,
        rememberUncertain: async (hash) => {
          f.uncertain.add(hash);
        },
        rawDelete: (key) => f.r2.delete(key),
        revoked: false,
      },
    );
    assert.equal((await f.r2.list()).objects.length, 2);
    assert.equal((await pointer(f.bucket, code))?.uid, "person");
  } finally {
    await f.mf.dispose();
  }
});

test("an unacknowledged body keeps its budget and a sweep record even if a late write reappears", async () => {
  const f = await fixture();
  try {
    await f.send("publish");
    await f.recover();
    const original = await pointer(f.bucket, code);
    f.failBody("after");
    await assert.rejects(f.send("update", "Revision B"), /body_response_lost/);
    const pending = f.pending();
    assert.ok(pending);
    assert.equal(pending.acknowledged, false);
    const key = `copies/${code}/${pending.sha256}`;
    const delayed = await (await f.r2.get(key))?.text();
    assert.ok(delayed);
    const reserved = (await f.storage.get<{ bytes: number }>("totals"))?.bytes;
    await f.recover();
    assert.equal((await pointer(f.bucket, code))?.meta.sha256, original?.meta.sha256);
    assert.ok(f.uncertain.has(pending.sha256));
    assert.equal(await f.r2.get(key), null);
    await f.r2.put(key, delayed);
    await sweepUncertainCopy(code, pending.sha256, {
      bucket: f.bucket,
      session: { uid: "person", idToken: "local" },
      rawDelete: (key) => f.r2.delete(key),
    });
    assert.equal(await f.r2.get(key), null, "a late body is still tracked and swept");
    assert.equal(
      (await f.storage.get<{ bytes: number }>("totals"))?.bytes,
      reserved,
      "uncertain writes must not free budget prematurely",
    );
  } finally {
    await f.mf.dispose();
  }
});

test("an interrupted update retains a durable record before writing a new R2 body", async () => {
  const f = await fixture();
  try {
    await f.send("publish");
    f.clearPending();
    const first = await pointer(f.bucket, code);
    assert.ok(first);
    f.failPointer("before");
    await assert.rejects(f.send("update", "Revision B"), /pointer_write_failed/);
    assert.ok(f.pending(), "the interrupted update must remain recoverable");
    assert.notEqual(f.pending()?.sha256, first.meta.sha256);
    assert.equal((await f.r2.list({ prefix: `copies/${code}/` })).objects.length, 2);
    const intended = f.pending()?.sha256;
    await f.recover();
    assert.equal(
      (await pointer(f.bucket, code))?.meta.sha256,
      intended,
      "recovery completes the already-approved update",
    );
    assert.deepEqual(
      (await f.r2.list({ prefix: `copies/${code}/` })).objects.map((item) => item.key),
      [`copies/${code}/${intended}`],
    );
    assert.equal([...f.values.keys()].filter((key) => key.startsWith("object/copies/")).length, 1);
    await f.send("update", "Revision C");
    await f.recover();
    assert.equal((await f.r2.list({ prefix: `copies/${code}/` })).objects.length, 1);
    await f.send("revoke");
    assert.equal((await f.r2.list()).objects.length, 0);
    assert.equal((await f.storage.get<{ bytes: number }>("totals"))?.bytes, 0);
  } finally {
    await f.mf.dispose();
  }
});
