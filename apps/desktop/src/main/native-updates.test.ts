import assert from "node:assert/strict";
import http from "node:http";
import { registerHooks } from "node:module";
import { after, test } from "node:test";
import { PROTOCOL_VERSION } from "@apx/protocol/client";
import type { BaseWindow } from "electron";
import { tempDir, waitFor } from "../../../core/src/testkit/platform.ts";
import { updateCredentials } from "./update-credentials.ts";
import type { createDesktopUpdater } from "./updater.ts";

const temporary = tempDir("apx-native-updates-test-");
const directory = temporary.path;
const messages: Record<string, unknown>[] = [];
const encryption = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decrypt: (value: Buffer) => value.toString().split("").reverse().join(""),
};
const boundary = Symbol.for("apx.test.native-updates");
Object.assign(globalThis, {
  [boundary]: {
    app: { getPath: () => directory, getVersion: () => "2.0.0", getLocale: () => "en" },
    dialog: {
      showMessageBox: async (_window: unknown, options: Record<string, unknown>) => {
        messages.push(options);
        return { response: 2 };
      },
    },
    safeStorage: {
      isEncryptionAvailable: encryption.available,
      encryptString: encryption.encrypt,
      decryptString: encryption.decrypt,
      getSelectedStorageBackend: () => "secret_service",
    },
  },
});
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.native-updates")]; export const app = n.app; export const dialog = n.dialog; export const safeStorage = n.safeStorage;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { nativeUpdates } = await import("./native-updates.ts");
hooks.deregister();
Reflect.deleteProperty(globalThis, boundary);
after(() => temporary.remove());

function rawUpdater() {
  let installs = 0;
  let restarts = 0;
  let quits = 0;
  return {
    updater: {
      enabled: true,
      mode: "auto",
      status: () => ({ current: "2.0.0", latest: "2.1.0", notes: [], install: "auto" }),
      check: async () => ({ current: "2.0.0", latest: "2.1.0", notes: [], install: "auto" }),
      install: async (target?: string, defer?: boolean) => {
        assert.equal(target, "2.1.0");
        assert.equal(defer, true);
        installs++;
        return { ok: true, ready: true };
      },
      restart: () => {
        restarts++;
      },
      quitting: () => {
        quits++;
      },
      discard: () => {},
      start: () => {},
      stop: () => {},
    } as ReturnType<typeof createDesktopUpdater>,
    counts: () => ({ installs, restarts, quits }),
  };
}

test("native updates use authenticated protocol directly without SSH or a loaded panel", async () => {
  const methods: string[] = [];
  let running = "2.0.0";
  let coordinated = false;
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer paired-device-token");
    assert.ok(request.headers["idempotency-key"]);
    let text = "";
    for await (const chunk of request) text += chunk;
    const params = JSON.parse(text) as { target?: string };
    const method = request.url?.split("/").pop();
    methods.push(method ?? "");
    const plan = () => ({ target: "2.1.0", running, phase: running === "2.1.0" ? "complete" : "prepared" });
    let result: unknown;
    if (method === "system.health") result = { home_id: "installation-a", protocol: PROTOCOL_VERSION };
    else if (method === "system.update_state")
      result = { running, coordination_protocol: 1, supported: true, coordination: coordinated ? plan() : null };
    else if (method === "system.update_prepare") {
      assert.equal(params.target, "2.1.0");
      coordinated = true;
      result = plan();
    } else if (method === "system.update") {
      assert.equal(params.target, "2.1.0");
      running = "2.1.0";
      result = { ok: true, restart: true, log: "" };
    } else assert.fail(`Unexpected method ${method}`);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  updateCredentials(directory, encryption).write("remote-installation", "paired-device-token");
  const raw = rawUpdater();
  const native = nativeUpdates(raw.updater, {} as BaseWindow, { change: async () => {} });
  try {
    native.connect({ identity: "remote-installation", url, local: false });
    assert.equal(native.automatic(), false);
    native.panelUnavailable();
    assert.equal(raw.counts().installs, 0);
    assert.deepEqual(messages.at(-1)?.buttons, ["Retry", "Change connection", "Later"]);
    assert.equal((await native.install()).ok, true);
    assert.equal(methods.filter((method) => method === "system.update").length, 1);
    assert.equal(raw.counts().installs, 1);
    native.quitting();
    assert.equal(raw.counts().quits, 0);
    assert.equal(raw.counts().restarts, 0);
  } finally {
    native.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("native protocol warnings respect the authenticated stable update lane", async () => {
  for (const lane of ["supported", "unsupported", "unknown", "missing"] as const) {
    messages.length = 0;
    let stateReads = 0;
    const state = {
      running: "2.1.0",
      coordination: null,
      ...(lane === "missing" ? {} : { coordination_protocol: lane === "unknown" ? 2 : 1 }),
      supported: lane !== "unsupported",
    };
    const server = http.createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* Drain the request before replying. */
      }
      const method = request.url?.split("/").pop();
      let result: unknown;
      if (method === "system.health") result = { home_id: "installation-a", protocol: PROTOCOL_VERSION + 1 };
      else if (method === "system.update_state") {
        stateReads++;
        result = state;
      } else result = { target: "2.1.0", running: "2.1.0", phase: "complete" };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, result }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const native = nativeUpdates(rawUpdater().updater, {} as BaseWindow, { change: async () => {} });
    try {
      native.connect({
        identity: `lane-${lane}`,
        url: `http://127.0.0.1:${address.port}`,
        token: "paired-device-token",
        local: false,
      });
      await waitFor(() => stateReads >= 2);
      if (lane === "supported") {
        assert.equal((await native.install()).ok, true);
        assert.equal(messages.length, 0);
      } else {
        await waitFor(() => messages.some((message) => String(message.detail).includes("incompatible protocol")));
      }
    } finally {
      native.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }
});

test("credentials are identity-scoped and never persisted without OS-backed encryption", () => {
  const cache = updateCredentials(directory, encryption);
  cache.write("server-a", "paired-device-token");
  assert.equal(cache.read("server-a"), "paired-device-token");
  assert.equal(cache.read("server-b"), undefined);
  const unavailable = updateCredentials(directory, { ...encryption, available: () => false });
  assert.equal(unavailable.read("server-a"), undefined);
  unavailable.write("server-a", "paired-device-token");
  assert.equal(cache.read("server-a"), undefined);
});
