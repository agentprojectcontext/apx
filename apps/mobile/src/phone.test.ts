import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

test("the phone node releases late connections and cancels scheduled reconnects when stopped", async (t) => {
  type Handler = (method: string, params: unknown) => Promise<unknown>;
  function socket() {
    const ended = Promise.withResolvers<void>();
    const s = {
      closed: ended.promise,
      handler: undefined as Handler | undefined,
      closes: 0,
      onRequest(handler: Handler) {
        s.handler = handler;
      },
      close() {
        s.closes++;
        ended.resolve();
      },
    };
    return s;
  }
  const calls: unknown[][] = [];
  const waiting: ReturnType<typeof Promise.withResolvers<ReturnType<typeof socket>>>[] = [];
  let allowed = true;
  let deliver = true;
  let removed = 0;
  let stateChanged: ((state: string) => void) | undefined;
  const locationCalls: unknown[] = [];
  const api = {
    ApxClient: class {
      async call() {
        return { location: true, revision: "test" };
      }
      async connect(...args: unknown[]) {
        calls.push(args);
        const pending = Promise.withResolvers<ReturnType<typeof socket>>();
        waiting.push(pending);
        return pending.promise;
      }
    },
    AppState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (state: string) => void) => {
        stateChanged = listener;
        return { remove() {} };
      },
    },
    Location: {
      Accuracy: { High: 4 },
      async getForegroundPermissionsAsync() {
        return { granted: allowed };
      },
      async watchPositionAsync(options: unknown, receive: (p: unknown) => void) {
        locationCalls.push(options);
        if (deliver) receive({ coords: { latitude: 10, longitude: 20, accuracy: 5 } });
        return {
          remove() {
            removed++;
          },
        };
      },
    },
  };
  const key = Symbol.for("apx.phone-test");
  Reflect.set(globalThis, key, api);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "expo-location") return { url: "apx-phone-test:location", shortCircuit: true };
      if (specifier === "react-native") return { url: "apx-phone-test:native", shortCircuit: true };
      if (specifier === "./protocol" && context.parentURL?.endsWith("/phone.ts"))
        return { url: "apx-phone-test:protocol", shortCircuit: true };
      if (specifier === "./phoneRequests" || specifier === "./phoneLocation") return next(`${specifier}.ts`, context);
      return next(specifier, context);
    },
    load(url, context, next) {
      const base = 'const api = globalThis[Symbol.for("apx.phone-test")];';
      if (url === "apx-phone-test:protocol")
        return { shortCircuit: true, format: "module", source: `${base} export const ApxClient = api.ApxClient;` };
      if (url === "apx-phone-test:native")
        return { shortCircuit: true, format: "module", source: `${base} export const AppState = api.AppState;` };
      if (url === "apx-phone-test:location")
        return {
          shortCircuit: true,
          format: "module",
          source: `${base} export const { Accuracy, getForegroundPermissionsAsync, watchPositionAsync } = api.Location;`,
        };
      return next(url, context);
    },
  });
  t.after(() => {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, key);
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { startPhoneNode } = await import("./phone.ts");
  const creds = { url: "https://core.example.com", token: "test-key", device: "phone" };
  const stopLate = startPhoneNode(creds, async () => undefined);
  stopLate();
  const late = socket();
  waiting.shift()?.resolve(late);
  await setImmediate();
  assert.equal(late.closes, 1, "a connection established after stop must be closed");
  assert.equal(late.handler, undefined);

  const stop = startPhoneNode(creds, async () => ({ mime: "image/jpeg", data: "AAA" }));
  const connected = socket();
  waiting.shift()?.resolve(connected);
  await setImmediate();
  assert.deepEqual(calls.at(-1), ["node", ["location", "camera"]]);
  assert.ok(connected.handler);
  const position = (await connected.handler("phone.location", {})) as {
    lat: number;
    lon: number;
    accuracy_m: number;
    at: string;
  };
  assert.deepEqual(
    { lat: position.lat, lon: position.lon, accuracy_m: position.accuracy_m },
    { lat: 10, lon: 20, accuracy_m: 5 },
  );
  assert.ok(Number.isFinite(Date.parse(position.at)));
  assert.deepEqual(locationCalls, [{ accuracy: 4, mayShowUserSettingsDialog: false }]);
  deliver = false;
  const background = assert.rejects(connected.handler("phone.location", {}), /allow/);
  await setImmediate();
  api.AppState.currentState = "background";
  stateChanged?.("background");
  await background;
  assert.equal(removed, 2, "backgrounding removes the in-flight watcher without waiting for paused JS timers");
  const count = locationCalls.length;
  await assert.rejects(connected.handler("phone.location", {}), /allow/);
  assert.equal(locationCalls.length, count, "a background phone never starts another capture");
  api.AppState.currentState = "active";
  allowed = false;
  await assert.rejects(connected.handler("phone.location", {}), /allow/);
  allowed = true;
  const disconnected = assert.rejects(connected.handler("phone.location", {}), /allow/);
  await setImmediate();
  connected.close();
  await disconnected;
  assert.equal(removed, 3, "socket loss removes its capture without waiting for an HTTP poll");
  await setImmediate();
  stop();
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(calls.length, 2, "stopping cancels a reconnect already scheduled");
});
