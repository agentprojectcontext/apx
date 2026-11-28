import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePhoneLocation, type LocationPrivacy, type PhonePosition } from "./phoneLocation.ts";

function fixture() {
  let privacy: LocationPrivacy = { location: true, revision: "first" };
  let receive: ((position: PhonePosition) => void) | undefined;
  let check: (() => void) | undefined;
  let expire: (() => void) | undefined;
  let removed = false;
  let watches = 0;
  const deps = {
    privacy: async () => privacy,
    permitted: async () => true,
    watch: async (cb: (position: PhonePosition) => void) => {
      watches++;
      receive = cb;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
    poll: (cb: () => void) => {
      check = cb;
      return () => {
        check = undefined;
      };
    },
    deadline: (cb: () => void) => {
      expire = cb;
      return () => {
        expire = undefined;
      };
    },
  };
  return {
    deps,
    set: (value: LocationPrivacy) => {
      privacy = value;
    },
    fix: () => receive?.({ lat: 1, lon: 2 }),
    check: () => check?.(),
    expire: () => expire?.(),
    get removed() {
      return removed;
    },
    get watches() {
      return watches;
    },
  };
}

async function start(f: ReturnType<typeof fixture>) {
  const ready = Promise.withResolvers<void>();
  const watch = f.deps.watch;
  f.deps.watch = async (cb) => {
    const subscription = await watch(cb);
    ready.resolve();
    return subscription;
  };
  const result = capturePhoneLocation(f.deps);
  await ready.promise;
  return { result };
}

test("revocation during the OS permission read prevents watcher registration", async () => {
  const f = fixture();
  const permission = Promise.withResolvers<boolean>();
  const reading = Promise.withResolvers<void>();
  f.deps.permitted = async () => {
    reading.resolve();
    return permission.promise;
  };
  const result = capturePhoneLocation(f.deps);
  await reading.promise;
  f.set({ location: false, revision: "revoked" });
  permission.resolve(true);
  assert.equal(await result, undefined);
  assert.equal(f.watches, 0);
});

test("disabled location never asks the OS for a fix", async () => {
  const f = fixture();
  f.set({ location: false, revision: "off" });
  assert.equal(await capturePhoneLocation(f.deps), undefined);
  assert.equal(f.watches, 0);
});

test("revocation in flight removes the watcher and drops its late fix", async () => {
  const f = fixture();
  const { result } = await start(f);
  f.set({ location: false, revision: "off" });
  f.check();
  assert.equal(await result, undefined);
  assert.equal(f.removed, true);
  f.fix();
  assert.equal(await result, undefined);
});

test("off then on cannot release a fix captured under the previous consent", async () => {
  const f = fixture();
  const { result } = await start(f);
  f.set({ location: true, revision: "new" });
  f.fix();
  assert.equal(await result, undefined);
  assert.equal(f.removed, true);
});

test("an allowed fix is returned and the location watcher is removed", async () => {
  const f = fixture();
  const { result } = await start(f);
  f.fix();
  assert.deepEqual(await result, { lat: 1, lon: 2 });
  assert.equal(f.removed, true);
});

test("deadline removes the watcher without returning a stale position", async () => {
  const f = fixture();
  const { result } = await start(f);
  f.expire();
  assert.equal(await result, undefined);
  assert.equal(f.removed, true);
});
