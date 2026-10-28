import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { type TestContext, test } from "node:test";

let sequence = 0;

/** Replace Electron's native boundary; execute the actual preload module. */
async function preload(t: TestContext, sync: Record<string, unknown> = {}) {
  const calls: [string, string, ...unknown[]][] = [];
  const worlds: Record<string, Record<string, unknown>> = {};
  const renderer = Object.assign(new EventEmitter(), {
    send(channel: string, ...args: unknown[]) {
      calls.push(["send", channel, ...args]);
    },
    sendSync(channel: string) {
      calls.push(["sync", channel]);
      return sync[channel];
    },
    async invoke(channel: string, ...args: unknown[]) {
      calls.push(["invoke", channel, ...args]);
      return { channel, args };
    },
  });
  const key = Symbol.for(`apx.preload-test.${sequence++}`);
  Reflect.set(globalThis, key, {
    contextBridge: {
      exposeInMainWorld(name: string, api: Record<string, unknown>) {
        assert.equal(worlds[name], undefined, "a bridge is exposed only once");
        worlds[name] = api;
      },
    },
    ipcRenderer: renderer,
  });
  const url = `apx-preload:${Symbol.keyFor(key)}`;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier === "electron" ? { url, shortCircuit: true } : next(specifier, context);
    },
    load(specifier, context, next) {
      return specifier === url
        ? {
            format: "module",
            shortCircuit: true,
            source: `export const { contextBridge, ipcRenderer } = globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})];`,
          }
        : next(specifier, context);
    },
  });
  t.after(() => {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, key);
    renderer.removeAllListeners();
  });
  await import(new URL(`./preload.ts?test=${sequence}`, import.meta.url).href);
  const call = (world: string, method: string, ...args: unknown[]) => {
    const fn = worlds[world]?.[method];
    assert.equal(typeof fn, "function", `${world}.${method} is callable`);
    return Reflect.apply(fn as (...args: unknown[]) => unknown, undefined, args);
  };
  return { calls, worlds, renderer, call };
}

test("preload exposes only the panel and connection bridges, with strict native state values", async (t) => {
  const { worlds, call } = await preload(t, {
    "desktop:core-token": "test-token",
    "desktop:core-local": true,
    "browser:popout-state": true,
  });
  assert.deepEqual(Object.keys(worlds).sort(), ["apxConnect", "apxDesktop"]);
  assert.equal(worlds.apxDesktop?.platform, process.platform);
  assert.equal(worlds.apxDesktop?.coreToken, "test-token");
  assert.equal(worlds.apxDesktop?.coreLocal, true);
  assert.equal(call("apxDesktop", "browserPoppedOut"), true);
  for (const api of Object.values(worlds)) {
    for (const forbidden of ["ipcRenderer", "send", "sendSync", "invoke", "require", "process"])
      assert.equal(forbidden in api, false, `${forbidden} must not cross the context bridge`);
  }
  const remote = await preload(t, { "desktop:core-local": "true", "browser:popout-state": 1 });
  assert.equal(remote.worlds.apxDesktop?.coreToken, undefined);
  assert.equal(remote.worlds.apxDesktop?.coreLocal, false);
  assert.equal(remote.call("apxDesktop", "browserPoppedOut"), false);
});

test("panel actions use fixed IPC channels and normalize browser, attention and menu arguments", async (t) => {
  const { call, calls } = await preload(t);
  calls.length = 0;
  const bounds = { x: 2, y: 3, width: 400, height: 300 };
  const prefs = { shortcut: "CommandOrControl+Shift+Space", launchAtLogin: false, computerUse: true };
  const cases: [string, unknown[], string, unknown[]][] = [
    ["setBrowserBounds", [bounds], "panel:browser-bounds", [bounds]],
    ["setBrowserBounds", [null], "panel:browser-bounds", [null]],
    ["showBrowserTab", ["tab_1"], "panel:browser-tab", ["tab_1"]],
    ["popOutBrowser", [true], "browser:popout", [true]],
    ["popOutBrowser", ["true"], "browser:popout", [false]],
    ["openMain", ["thr_1"], "quick:open-main", ["thr_1"]],
    ["openMain", [13], "quick:open-main", [undefined]],
    ["applyDesktopPrefs", [prefs], "desktop:prefs", [prefs]],
    ["setAttention", ["12"], "desktop:attention", [12]],
    ["setAttention", ["invalid"], "desktop:attention", [0]],
    ["setTitleBar", ["dark"], "desktop:titlebar", ["dark"]],
    ["setLanguage", [123], "desktop:language", ["123"]],
    ["menuAction", ["about"], "desktop:menu-action", ["about"]],
    ["restartToUpdate", [], "desktop:update-restart", []],
  ];
  for (const [method, args, channel, forwarded] of cases) {
    call("apxDesktop", method, ...args);
    assert.deepEqual(calls.at(-1), ["send", channel, ...forwarded], method);
  }
  assert.equal(calls.length, cases.length);
});

test("panel requests return native replies without exposing a general invoke capability", async (t) => {
  const { call, calls, renderer } = await preload(t);
  calls.length = 0;
  const cases: [string, unknown[], string, unknown[]][] = [
    ["installedBrowsers", [], "browser:installed", []],
    ["openExternal", ["https://example.com", "firefox"], "browser:open-external", ["https://example.com", "firefox"]],
    ["openExternal", [12, false], "browser:open-external", ["12", undefined]],
    ["computerPermissions", [], "computer:permissions", []],
    ["openPrivacy", ["screen"], "computer:open-privacy", ["screen"]],
    ["computerFrame", [], "computer:frame", []],
    ["stopComputer", [], "computer:stop", []],
    ["pickFolder", [], "panel:pick-folder", []],
    ["memory", [], "desktop:memory", []],
    ["updateStatus", [true], "desktop:update-status", [true]],
    ["updateStatus", ["true"], "desktop:update-status", [false]],
    ["installUpdate", [], "desktop:update-install", []],
  ];
  for (const [method, args, channel, forwarded] of cases) {
    assert.deepEqual(await call("apxDesktop", method, ...args), { channel, args: forwarded }, method);
    assert.deepEqual(calls.at(-1), ["invoke", channel, ...forwarded]);
  }
  assert.equal(calls.length, cases.length);
  renderer.invoke = async () => {
    throw new Error("Native request failed");
  };
  await assert.rejects(Promise.resolve(call("apxDesktop", "installUpdate")), /Native request failed/);
});

test("connection actions preserve server and SSH answers, while cancellation sends no password", async (t) => {
  const { call, calls } = await preload(t);
  const cases: [string, unknown[], string][] = [
    ["local", ["lan"], "connect:local"],
    ["url", ["https://apx.example.com"], "connect:url"],
    ["ssh", ["user@server"], "connect:ssh"],
    ["installSsh", ["user@server"], "connect:ssh-install"],
    ["lingerSsh", ["user@server", "test-password"], "connect:ssh-linger"],
  ];
  for (const [method, args, channel] of cases) {
    assert.deepEqual(await call("apxConnect", method, ...args), { channel, args });
    assert.deepEqual(calls.at(-1), ["invoke", channel, ...args]);
  }
  call("apxConnect", "answer", 42, "test-password");
  assert.deepEqual(calls.at(-1), ["send", "connect:answer", "42", "test-password"]);
  for (const value of [undefined, null, 123]) {
    call("apxConnect", "answer", "prompt_1", value);
    assert.deepEqual(calls.at(-1), ["send", "connect:answer", "prompt_1", undefined]);
  }
});

test("native listeners strip the Electron event, validate payloads and detach their exact subscription", async (t) => {
  const { call, renderer } = await preload(t);
  const cases: [string, string, string, unknown[], unknown[]][] = [
    ["apxDesktop", "onBrowserPopout", "browser:popout", [true, "true", false], [true, false, false]],
    ["apxDesktop", "onOpenThread", "nav:thread", ["thr_1", null, 123, "thr_2"], ["thr_1", "thr_2"]],
    ["apxDesktop", "onComputerStopped", "computer:stopped", [true, 1, false], [true, false, false]],
    ["apxDesktop", "onComputerActivity", "computer:activity", [{ kind: "click" }, null], [{ kind: "click" }, null]],
    ["apxDesktop", "onUpdateStatus", "desktop:update-changed", [{ latest: "2.1.0" }], [{ latest: "2.1.0" }]],
    ["apxConnect", "onStep", "connect:step", ["probe", "connect"], ["probe", "connect"]],
    ["apxConnect", "onProgress", "connect:progress", ["ready"], ["ready"]],
    [
      "apxConnect",
      "onPrompt",
      "connect:prompt",
      [{ id: "p1", text: "Password", secret: true }, null],
      [{ id: "p1", text: "Password", secret: true }, null],
    ],
  ];
  for (const [world, method, channel, payloads, expected] of cases) {
    const received: unknown[][] = [];
    const other: unknown[] = [];
    const unrelated = (_event: unknown, payload: unknown) => other.push(payload);
    renderer.on(channel, unrelated);
    const stop = call(world, method, (...args: unknown[]) => received.push(args));
    assert.equal(typeof stop, "function", `${method} returns only an unsubscribe function`);
    const nativeEvent = { sender: renderer, privileged: true };
    for (const payload of payloads) renderer.emit(channel, nativeEvent, payload);
    assert.deepEqual(
      received,
      expected.map((value) => [value]),
      `${method} never forwards the native event`,
    );
    Reflect.apply(stop as () => void, undefined, []);
    Reflect.apply(stop as () => void, undefined, []);
    assert.equal(renderer.listenerCount(channel), 1, `${method} leaves unrelated listeners intact`);
    renderer.emit(channel, nativeEvent, "after unsubscribe");
    assert.equal(received.length, expected.length);
    assert.deepEqual(other, [...payloads, "after unsubscribe"]);
    renderer.off(channel, unrelated);
  }
});

test("native fullscreen is kept from the window's reports, for listeners and for a page that reads it later", async (t) => {
  const { call, renderer } = await preload(t);
  const nativeEvent = { sender: renderer };
  assert.equal(call("apxDesktop", "isFullScreen"), false);
  const heard: unknown[][] = [];
  const stop = call("apxDesktop", "onFullScreen", (...args: unknown[]) => heard.push(args));
  for (const payload of [true, "true", 1]) renderer.emit("window:fullscreen", nativeEvent, payload);
  assert.equal(call("apxDesktop", "isFullScreen"), true);
  assert.deepEqual(heard, [[true]]);
  Reflect.apply(stop as () => void, undefined, []);
  renderer.emit("window:fullscreen", nativeEvent, false);
  assert.equal(call("apxDesktop", "isFullScreen"), false);
  assert.deepEqual(heard, [[true]]);
});
