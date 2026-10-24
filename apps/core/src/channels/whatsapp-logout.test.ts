import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import type { AdapterIO } from "./types.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const io = (codes: string[]): AdapterIO => ({
  receive() {},
  action() {},
  status() {},
  qr: (code) => {
    if (code) codes.push(code);
  },
  signal: new AbortController().signal,
});

test("logout drains credential writes before deleting the session and cancels the linking restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-logout-"));
  const fake = fakeWhatsApp();
  const codes: string[] = [];
  let writing = false;
  let release = () => {};
  let finishSave = () => {};
  const saved = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const adapter = whatsappAdapter({
    dir,
    lib: async () => ({
      ...fake.lib,
      async useMultiFileAuthState(folder) {
        const auth = await fake.lib.useMultiFileAuthState(folder);
        return {
          ...auth,
          async saveCreds() {
            writing = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            await auth.saveCreds();
            finishSave();
          },
        };
      },
    }),
  });
  try {
    await adapter.start(io(codes));
    await waitFor(() => codes.length === 1);
    fake.scan();
    await waitFor(() => writing);
    const forgotten = adapter.forget?.();
    release();
    await forgotten;
    await saved;
    // The save barrier above establishes completion; no sleep is needed to check disk cleanup.
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fake.loggedOut.value, true);
    assert.equal(fake.sockets, 1, "the scan's queued restart must not reconnect after logout");
    const fresh = whatsappAdapter({ dir, lib: async () => fake.lib });
    try {
      await fresh.start(io(codes));
      await waitFor(() => codes.length === 2);
      assert.equal(fs.existsSync(path.join(dir, "creds.json")), false);
    } finally {
      await fresh.stop();
    }
  } finally {
    release();
    await adapter.stop();
    await removeDir(dir);
  }
});

test("phone revocation drains a pending save before reporting that the old session was discarded", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-revoked-"));
  const fake = fakeWhatsApp();
  const codes: string[] = [];
  let writing = false;
  let release = () => {};
  let error = "";
  const adapter = whatsappAdapter({
    dir,
    lib: async () => ({
      ...fake.lib,
      async useMultiFileAuthState(folder) {
        const auth = await fake.lib.useMultiFileAuthState(folder);
        return {
          ...auth,
          async saveCreds() {
            writing = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            await auth.saveCreds();
          },
        };
      },
    }),
  });
  try {
    await adapter.start({
      ...io(codes),
      status: (_state, detail) => {
        error = detail ?? "";
      },
    });
    await waitFor(() => codes.length === 1);
    fake.scan();
    await waitFor(() => writing);
    fake.logOut();
    release();
    await waitFor(() => error.includes("link it again"));
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fake.sockets, 1, "a revoked device must not reconnect after the pending save");
  } finally {
    release();
    await adapter.stop();
    await removeDir(dir);
  }
});

test("logout during socket initialization waits for disk work and never opens the old session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-init-"));
  const fake = fakeWhatsApp();
  let release = () => {};
  let initializing = false;
  const adapter = whatsappAdapter({
    dir,
    lib: async () => ({
      ...fake.lib,
      async useMultiFileAuthState(folder) {
        initializing = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "creds.json"), "{}");
        return fake.lib.useMultiFileAuthState(folder);
      },
    }),
  });
  try {
    const starting = adapter.start(io([]));
    await waitFor(() => initializing);
    const forgetting = adapter.forget?.();
    release();
    await Promise.all([starting, forgetting]);
    assert.equal(fake.sockets, 0);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    release();
    await adapter.stop();
    await removeDir(dir);
  }
});

test("removing a stopped WhatsApp channel survives core restart without reusing credentials or touching another account", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-core-"));
  const fakes = new Map([
    ["whatsapp", fakeWhatsApp()],
    ["work", fakeWhatsApp()],
  ]);
  const llm = scriptedLlm(() => say("Hello"));
  const boot = () =>
    startCore({
      home,
      llm,
      channelAdapters: {
        whatsapp: (c) =>
          whatsappAdapter({
            dir: path.join(home, "channels", c.id),
            lib: async () => {
              const fake = fakes.get(c.id);
              assert.ok(fake);
              return fake.lib;
            },
          }),
      },
    });
  let env = await boot();
  const config = { type: "whatsapp" as const, agent_id: "roby" };
  const channel = async (id: string) => (await env.client.call("channels.list", {})).channels.find((c) => c.id === id);
  try {
    for (const [id, fake] of fakes) {
      await env.client.call("channels.set", { id, channel: config });
      await waitFor(async () => Boolean((await channel(id))?.qr));
      fake.scan();
      await waitFor(async () => (await channel(id))?.status === "running");
    }
    const other = path.join(home, "channels", "work", "creds.json");
    const otherCreds = fs.readFileSync(other);
    await env.client.call("channels.set", { id: "whatsapp", channel: { ...config, enabled: false } });
    assert.ok(fs.existsSync(path.join(home, "channels", "whatsapp", "creds.json")), "stop preserves the session");
    await env.core.close();
    env = await boot();
    await env.client.call("channels.set", { id: "whatsapp", channel: null });
    assert.equal(
      fs.existsSync(path.join(home, "channels", "whatsapp")),
      false,
      "logout also cleans a non-live channel",
    );
    assert.deepEqual(fs.readFileSync(other), otherCreds);
    assert.equal(fakes.get("work")?.loggedOut.value, false);
    await env.core.close();
    env = await boot();
    const replacement = fakeWhatsApp("5491100000004@s.whatsapp.net");
    fakes.set("whatsapp", replacement);
    await env.client.call("channels.set", { id: "whatsapp", channel: config });
    await waitFor(async () => Boolean((await channel("whatsapp"))?.qr));
    replacement.scan();
    await waitFor(async () => (await channel("whatsapp"))?.status === "running");
    assert.equal((await channel("whatsapp"))?.account, "+5491100000004");
    await waitFor(async () => (await channel("work"))?.status === "running");
    assert.deepEqual(fs.readFileSync(other), otherCreds);
  } finally {
    await env.core.close();
    await removeDir(home);
  }
});
