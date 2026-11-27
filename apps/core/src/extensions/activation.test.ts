import assert from "node:assert/strict";
import { test } from "node:test";
import { activationGuard } from "./activation.ts";

function fixture() {
  const guard = activationGuard();
  let current = { id: "acme", enabled: false };
  const calls: boolean[] = [];
  const enable = (enabled: boolean, options: { only_if_disabled?: true; rollback_token?: string } = {}) =>
    guard.change(
      { id: "acme", enabled, ...options },
      () => current,
      () => {
        calls.push(enabled);
        current = { ...current, enabled };
        return current;
      },
    );
  return { guard, enable, calls, current: () => current };
}

test("a failed attempt can undo its own first activation", async () => {
  const f = fixture();
  const first = await f.enable(true, { only_if_disabled: true });
  assert.ok(first.activation_token);
  const off = await f.enable(false, { rollback_token: first.activation_token });
  assert.equal(off.enabled, false);
  assert.deepEqual(f.calls, [true, false]);
});

test("two overlapping stale connection attempts cannot adopt and roll back the same activation", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const first = (async () => {
    await f.enable(true, { only_if_disabled: true });
    entered.resolve();
    await ready.promise;
    return f.current();
  })();
  await entered.promise;
  await assert.rejects(f.enable(true, { only_if_disabled: true }), /already on/);
  ready.resolve();
  assert.equal((await first).enabled, true);
  assert.deepEqual(f.calls, [true]);
});

test("a later explicit activation cannot be undone by an earlier failed attempt", async () => {
  const f = fixture();
  const first = await f.enable(true, { only_if_disabled: true });
  await f.enable(false);
  await f.enable(true);
  const actual = await f.enable(false, { rollback_token: first.activation_token });
  assert.equal(actual.enabled, true);
  assert.deepEqual(f.calls, [true, false, true]);
});

test("a no-op explicit enable adopts the current connection and invalidates its old receipt", async () => {
  const f = fixture();
  const first = await f.enable(true, { only_if_disabled: true });
  await f.enable(true);
  assert.equal((await f.enable(false, { rollback_token: first.activation_token })).enabled, true);
  assert.deepEqual(f.calls, [true, true]);
});

test("a restarted core cannot use an old receipt to turn off persisted state", async () => {
  const f = fixture();
  const first = await f.enable(true, { only_if_disabled: true });
  const restarted = activationGuard();
  const actual = await restarted.change(
    { id: "acme", enabled: false, rollback_token: first.activation_token },
    f.current,
    () => assert.fail("A prior process's receipt must not change the persisted state"),
  );
  assert.equal(actual.enabled, true);
});

test("changes to the package invalidate previous activation receipts", async () => {
  const f = fixture();
  const first = await f.enable(true, { only_if_disabled: true });
  f.guard.invalidate("acme");
  assert.equal((await f.enable(false, { rollback_token: first.activation_token })).enabled, true);
  assert.deepEqual(f.calls, [true]);
});
