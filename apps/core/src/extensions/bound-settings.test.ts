import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

test("connection credentials require a different replacement with changed full address or username, without partial saves", async () => {
  await using source = tempDir("apx-bound-setting-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "shop",
        name: "Shop",
        version: "1.0.0",
        settings: [
          { name: "address", label: "Address", type: "string", required: true },
          { name: "username", label: "Username", type: "string", required: true },
          { name: "password", label: "Password", type: "string", sensitive: true, boundTo: ["address", "username"] },
        ],
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    const save = (values: Record<string, string | null>) =>
      env.client.call("extensions.settings", { id: "shop", values });
    const address = "https://shop.example/store";
    await save({ address, username: "reader", password: "first fixture password" });
    const changes: Record<string, string>[] = [{ address: "https://shop.example/other" }, { username: "other" }];
    for (const change of changes) {
      for (const password of [undefined, "first fixture password", "firstfixturepassword", null]) {
        await assert.rejects(
          save({ ...change, ...(password === undefined ? {} : { password }) }),
          /different application password/,
        );
        const info = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "shop");
        assert.equal(info?.settings.find((s) => s.name === "address")?.value, address);
        assert.equal(info?.settings.find((s) => s.name === "username")?.value, "reader");
      }
    }
    await save({ address: "https://shop.example/other", password: "second fixture password" });
    await save({ username: "other", password: "third fixture password" });
    await save({ username: "other" });
    const info = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "shop");
    assert.equal(info?.settings.find((s) => s.name === "password")?.value, undefined);
    assert.equal(info?.settings.find((s) => s.name === "password")?.set, true);
    await env.client.call("secrets.set", { name: "ext-shop-password", value: "legacy fixture password" });
    await assert.rejects(save({ username: "other" }), /different application password/);
    await assert.rejects(save({ password: "legacy fixture password" }), /different application password/);
    await save({ password: "new fixture password" });
    await assert.rejects(
      save({ address: "https://shop.example/another", password: "newfixturepassword" }),
      /different application password/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
