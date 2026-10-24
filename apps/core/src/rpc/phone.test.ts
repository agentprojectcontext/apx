import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError, type ApxSocket } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { callTool, say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { reachableAt } from "../server-wiring.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";

// The smallest bytes a JPEG check accepts: its magic and an end marker.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 80)}`);
  if (said.includes("where am I")) return callTool("l1", "phone_location", {});
  if (said.includes("show me the fridge")) return callTool("p1", "phone_photo", { reason: "the fridge" });
  return say(`tools: ${req.tools.map((t) => t.function.name).join(",")}`);
});

const pushes: Array<Record<string, unknown>> = [];
const expo = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    pushes.push(JSON.parse(raw) as Record<string, unknown>);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"data":{"status":"ok"}}');
  });
});

let core: Awaited<ReturnType<typeof createCore>>;
let home = "";
let owner: ApxClient;
let phone: ApxSocket | undefined;

before(async () => {
  await new Promise<void>((r) => expo.listen(0, "127.0.0.1", r));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-phone-"));
  core = await createCore(
    {
      ...testConfig({ home }),
      expoPushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`,
      publicUrl: "https://apx.example.ts.net",
    },
    { quiet: true, llm },
  );
  core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
  owner = new ApxClient({ url: core.url });
});
after(async () => {
  phone?.close();
  await core.close();
  await new Promise<void>((r) => expo.close(() => r()));
  await removeDir(home);
});

async function settle(thread: string) {
  for (let i = 0; i < 200; i++) {
    const t = (await owner.call("threads.get", { thread })).thread;
    if (t.state !== "working" && t.state !== "submitted") return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
const toolsSeen = async (thread: string) => {
  await owner.call("threads.send", { thread, text: "list" });
  await settle(thread);
  return JSON.stringify((await owner.call("threads.get", { thread })).messages.at(-1)?.parts ?? []);
};

test("the phone's tools are offered only while a phone lends them; then an agent asks where the owner is", async () => {
  const thread = (await owner.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  assert.doesNotMatch(await toolsSeen(thread), /phone_location/);

  const { code } = await owner.call("devices.pair_start", {});
  const { token } = await new ApxClient({ url: core.url }).call("devices.pair", {
    code,
    name: "iPhone",
    platform: "ios",
  });
  phone = await new ApxClient({ url: core.url, token }).connect("node", ["location", "camera"]);
  phone.onRequest(async (method, params) => {
    if (method === "phone.location")
      return { lat: -41.1335, lon: -71.3103, accuracy_m: 12, at: "2026-10-04T10:00:00Z" };
    if (method === "phone.photo") {
      assert.deepEqual(params, { reason: "the fridge" });
      return { mime: "image/jpeg", data: JPEG.toString("base64") };
    }
    throw new Error(`unknown ${method}`);
  });
  const seen = await toolsSeen(thread);
  assert.match(seen, /phone_location/);
  assert.match(seen, /phone_photo/);

  await owner.call("threads.send", { thread, text: "where am I?" });
  await settle(thread);
  const last = JSON.stringify((await owner.call("threads.get", { thread })).messages.at(-1));
  assert.match(last, /lat -41\.13350, lon -71\.31030 \(±12 m\)/);
});

test("a picture the owner takes on the phone is kept as media and shown in the chat", async () => {
  const thread = (await owner.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await owner.call("threads.send", { thread, text: "show me the fridge" });
  await settle(thread);
  const parts = (await owner.call("threads.get", { thread })).messages.flatMap((m) => m.parts);
  const image = parts.find((p) => p.type === "image");
  assert.ok(image?.type === "image" && image.media_id);
  assert.ok(core.store.media.get(image.media_id ?? ""));
});

test("a device sets its own push; notices then reach the phone instead of a channel", async () => {
  const { code } = await owner.call("devices.pair_start", {});
  const { token, device } = await new ApxClient({ url: core.url }).call("devices.pair", {
    code,
    name: "Pixel",
    platform: "android",
  });
  const self = new ApxClient({ url: core.url, token });
  const set = await self.call("devices.set_push", { push: { kind: "expo", token: "ExponentPushToken[abc123]" } });
  assert.equal(set.push, "expo");
  // The token itself never comes back.
  assert.doesNotMatch(JSON.stringify(await owner.call("devices.list", {})), /abc123/);
  // A device sets only its own.
  const other = (await owner.call("devices.list", {})).devices.find((d) => d.id !== device.id);
  await assert.rejects(
    self.call("devices.set_push", { id: other?.id ?? "", push: null }),
    (e: unknown) => e instanceof ApxError && e.code === "unauthorized",
  );

  const prefs = await owner.call("notices.get", {});
  await owner.call("notices.set", { ...prefs, channel: `device:${device.id}` });
  const r = await owner.call("routines.set", {
    name: "push-probe",
    agent: "roby",
    schedule: { kind: "manual" },
    action: "message",
    prompt: "Hola desde la rutina",
    enabled: true,
  });
  await owner.call("routines.run", { routine: r.id });
  await waitFor(() => pushes.length, "a push");
  assert.equal(pushes[0]?.to, "ExponentPushToken[abc123]");
  assert.match(String(pushes[0]?.body), /Hola desde la rutina/);
});

test("a public address goes first in the pairing QR", () => {
  assert.deepEqual(reachableAt("127.0.0.1", 7440, "https://apx.example.ts.net"), ["https://apx.example.ts.net"]);
});
