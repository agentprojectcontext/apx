import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

const currentSettings = [
  { name: "address", label: "Address", type: "string", format: "https-url", required: true },
  { name: "username", label: "Username", type: "string", required: true },
  { name: "password", label: "Password", type: "string", sensitive: true, boundTo: ["address", "username"] },
  { name: "unrelated", label: "Unrelated", type: "string", sensitive: true },
];

function writeManifest(dir: string, version: string, settings: unknown[], secrets: unknown[] = []) {
  fs.writeFileSync(
    path.join(dir, "apx-extension.json"),
    JSON.stringify({
      manifest: 2,
      id: "shop",
      name: "Shop",
      version,
      settings,
      secrets,
    }),
  );
}

test("HTTPS settings reject unsafe input before any write and bind to the canonical installation address", async () => {
  await using source = tempDir("apx-url-setting-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    writeManifest(source.path, "1.0.0", currentSettings);
    await env.client.call("extensions.install", { path: source.path });
    const save = (values: Record<string, string | null>) =>
      env.client.call("extensions.settings", { id: "shop", values });
    const info = async () => (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "shop");
    const unsafe = [
      "http://shop.example/store",
      "https://@shop.example/store",
      "https://user:synthetic@shop.example/store",
      "https://shop.example/store?",
      "https://shop.example/store#",
      "https://shop.example/store?q=synthetic",
      "https://shop.example/store#synthetic",
      "https:shop.example",
      "https://shop.example/\\other",
      "https://shop.example/\nstore",
      "not an address",
      "https://",
    ];
    for (const address of unsafe) {
      await assert.rejects(
        save({ unrelated: "synthetic secret", password: "synthetic password", username: "reader", address }),
        (err: Error) => {
          assert.match(err.message, /Enter an HTTPS address/);
          assert.equal(err.message.includes(address), false);
          assert.equal(err.message.includes("synthetic"), false);
          return true;
        },
      );
      const state = await info();
      assert.equal(
        state?.settings.some((s) => s.set),
        false,
      );
    }
    await save({
      address: "https://SHOP.example:443/store/",
      username: "reader",
      password: "first synthetic password",
    });
    assert.equal((await info())?.settings.find((s) => s.name === "address")?.value, "https://shop.example/store/");
    await save({ address: "https://shop.example:443/store/" });
    for (const address of unsafe) await assert.rejects(save({ address, password: "second synthetic password" }));
    await save({ address: "https://shop.example/store/" });
    assert.equal((await info())?.settings.find((s) => s.name === "password")?.set, true);
    await assert.rejects(save({ address: "https://shop.example/other/" }), /different application password/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("failed credential invalidation leaves upgrade and rollback files aligned with the installed record", async () => {
  await using source = tempDir("apx-credential-failure-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const installed = () => {
    const entry = env.core.store.extensions.get("shop");
    assert.ok(entry);
    const disk = JSON.parse(fs.readFileSync(path.join(entry.dir, "apx-extension.json"), "utf8"));
    assert.equal(disk.version, entry.manifest.version);
    return entry.manifest.version;
  };
  try {
    writeManifest(source.path, "1.0.0", [], [{ name: "legacy_auth", label: "Legacy credential" }]);
    await env.client.call("extensions.install", { path: source.path });
    writeManifest(source.path, "2.0.0", currentSettings);
    const fail = () =>
      mock.method(env.core.secrets, "set", () => {
        throw new Error("credential store unavailable");
      });
    const upgrade = fail();
    await assert.rejects(env.client.call("extensions.install", { path: source.path }));
    upgrade.mock.restore();
    assert.equal(installed(), "1.0.0");
    await env.client.call("extensions.install", { path: source.path });
    assert.equal(installed(), "2.0.0");
    const rollback = fail();
    await assert.rejects(env.client.call("extensions.rollback", { id: "shop" }));
    rollback.mock.restore();
    assert.equal(installed(), "2.0.0");
    await env.client.call("extensions.rollback", { id: "shop" });
    assert.equal(installed(), "1.0.0");
  } finally {
    mock.restoreAll();
    await env.core.close();
    await env.cleanup();
  }
});

test("upgrade and rollback clear changed credential contracts without disturbing unrelated credentials", async () => {
  await using source = tempDir("apx-credential-contract-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const legacy = [{ name: "unrelated", label: "Unrelated", type: "string", sensitive: true }];
    writeManifest(source.path, "1.0.0", legacy, [{ name: "legacy_auth", label: "Legacy credential" }]);
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("secrets.set", { name: "ext-shop-legacy_auth", value: "synthetic legacy credential" });
    await env.client.call("extensions.settings", {
      id: "shop",
      values: { unrelated: "synthetic unrelated credential" },
    });
    writeManifest(source.path, "2.0.0", currentSettings);
    const updated = await env.client.call("extensions.install", { path: source.path });
    assert.equal(updated.settings.find((s) => s.name === "password")?.set, false);
    assert.equal(updated.settings.find((s) => s.name === "unrelated")?.set, true);
    await env.client.call("extensions.settings", {
      id: "shop",
      values: {
        address: "https://shop.example/store/",
        username: "reader",
        password: "synthetic new credential",
      },
    });
    const rolledBack = await env.client.call("extensions.rollback", { id: "shop" });
    assert.equal(rolledBack.secrets.find((s) => s.name === "legacy_auth")?.set, false);
    assert.equal(rolledBack.settings.find((s) => s.name === "unrelated")?.set, true);
    const forward = await env.client.call("extensions.rollback", { id: "shop" });
    assert.equal(forward.settings.find((s) => s.name === "password")?.set, false);
    assert.equal(forward.settings.find((s) => s.name === "unrelated")?.set, true);
    await env.client.call("extensions.settings", {
      id: "shop",
      values: { password: "synthetic reconnected credential" },
    });
    writeManifest(source.path, "2.0.1", currentSettings);
    const sameContract = await env.client.call("extensions.install", { path: source.path });
    assert.equal(sameContract.settings.find((s) => s.name === "password")?.set, true);
    assert.equal(sameContract.settings.find((s) => s.name === "unrelated")?.set, true);
    const changedBinding = currentSettings.map((s) => (s.name === "password" ? { ...s, boundTo: ["address"] } : s));
    writeManifest(source.path, "2.1.0", changedBinding);
    const rebound = await env.client.call("extensions.install", { path: source.path });
    assert.equal(rebound.settings.find((s) => s.name === "password")?.set, false);
    assert.equal(rebound.settings.find((s) => s.name === "unrelated")?.set, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
