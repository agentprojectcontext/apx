import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError, pairingLink } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { reachableAt } from "../server-wiring.ts";

const TOKEN = "core-token-for-devices";
let core: Awaited<ReturnType<typeof createCore>>;
let home = "";
let owner: ApxClient;

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-devices-"));
  core = await createCore(
    { ...testConfig({ home }), token: TOKEN },
    { quiet: true, llm: scriptedLlm(() => say("ok")) },
  );
  owner = new ApxClient({ url: core.url, token: TOKEN });
});
after(async () => {
  await core.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const unauthorized = (e: unknown) => e instanceof ApxError && e.code === "unauthorized";

test("a phone trades the panel's one-time code for a token of its own, and acts as the owner with it", async () => {
  const start = await owner.call("devices.pair_start", {});
  assert.match(start.code, /^[2-9A-HJKMNP-Z]{8}$/);
  // This core listens only on this computer: no address a phone could reach.
  assert.deepEqual(start.urls, []);

  // No token at all: pairing is the one call that passes (the code is the key).
  const phone = new ApxClient({ url: core.url });
  await assert.rejects(phone.call("threads.list", {}), unauthorized);
  const { token, device } = await phone.call("devices.pair", {
    code: start.code.toLowerCase(),
    name: "Mi teléfono",
    platform: "ios",
  });
  assert.match(token, /^apxd_/);
  assert.equal(device.platform, "ios");
  // A code works once.
  await assert.rejects(phone.call("devices.pair", { code: start.code, name: "Otro" }), unauthorized);

  const paired = new ApxClient({ url: core.url, token });
  assert.ok(Array.isArray((await paired.call("threads.list", {})).threads));
  // It is the owner's own device: owner-only calls are open to it, and its socket connects.
  assert.equal((await paired.call("devices.list", {})).devices[0]?.name, "Mi teléfono");
  const socket = await paired.connect();
  socket.close();

  assert.deepEqual(await owner.call("devices.revoke", { id: device.id }), { revoked: true });
  await assert.rejects(paired.call("threads.list", {}), unauthorized);
  assert.deepEqual((await owner.call("devices.list", {})).devices, []);
});

test("native clients supply secure request keys for pairing over HTTP and socket calls", async () => {
  let generated = 0;
  const mobile = new ApxClient({ url: core.url, requestKey: () => `native-${++generated}` });
  const { code } = await owner.call("devices.pair_start", {});
  const { device, token } = await mobile.call("devices.pair", { code, name: "Native", platform: "android" });
  assert.equal(generated, 1);
  const paired = new ApxClient({ url: core.url, token, requestKey: () => `native-${++generated}` });
  const socket = await paired.connect();
  assert.ok((await socket.call("devices.list", {})).devices.some((d) => d.id === device.id));
  assert.equal(generated, 2);
  socket.close();
  await owner.call("devices.revoke", { id: device.id });
});

test("canceling a code refuses that pairing but preserves another pending code", async () => {
  const first = await owner.call("devices.pair_start", {});
  const second = await owner.call("devices.pair_start", {});
  const phone = new ApxClient({ url: core.url });
  await assert.rejects(phone.call("devices.pair_cancel", { code: second.code }), unauthorized);
  const socket = await owner.connect();
  assert.deepEqual(await socket.call("devices.pair_cancel", { code: first.code }), { canceled: true });
  socket.close();
  await assert.rejects(phone.call("devices.pair", { code: first.code, name: "Canceled" }), unauthorized);
  const paired = await phone.call("devices.pair", { code: second.code, name: "Kept" });
  await owner.call("devices.revoke", { id: paired.device.id });
});

test("wrong codes void every pending one and pause pairing for a while", async () => {
  const { code } = await owner.call("devices.pair_start", {});
  const phone = new ApxClient({ url: core.url });
  for (let i = 0; i < 5; i++)
    await assert.rejects(phone.call("devices.pair", { code: `WRONG${i}XX`, name: "x" }), unauthorized);
  await assert.rejects(
    phone.call("devices.pair", { code, name: "too late" }),
    (e: unknown) => unauthorized(e) && /too many wrong codes/.test((e as Error).message),
  );
});

test("the QR names the code and every address; a core on all interfaces lists its network ones", () => {
  assert.equal(
    pairingLink({ code: "ABCD2345", urls: ["http://192.168.1.20:7440", "http://100.64.0.3:7440"] }),
    "apx://pair?c=ABCD2345&u=http%3A%2F%2F192.168.1.20%3A7440&u=http%3A%2F%2F100.64.0.3%3A7440",
  );
  assert.deepEqual(reachableAt("127.0.0.1", 7440), []);
  assert.deepEqual(reachableAt("apx.example.com", 7440), ["http://apx.example.com:7440"]);
  for (const u of reachableAt("0.0.0.0", 7440)) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:7440$/);
});
