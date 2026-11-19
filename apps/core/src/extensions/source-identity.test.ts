import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs");

test("catalogs with the same displayed names do not share extension identity", async () => {
  const first = tempDir("catalog-first-");
  const second = tempDir("catalog-second-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    for (const [folder, content] of [
      [first, "Alpha"],
      [second, "Beta"],
    ] as const) {
      fs.mkdirSync(path.join(folder.path, ".claude-plugin"), { recursive: true });
      fs.mkdirSync(path.join(folder.path, "plugin", "skills", "task"), { recursive: true });
      fs.writeFileSync(
        path.join(folder.path, ".claude-plugin", "marketplace.json"),
        JSON.stringify({
          name: "Acme",
          plugins: [{ name: "shared", source: "./plugin" }],
        }),
      );
      fs.mkdirSync(path.join(folder.path, "plugin", ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(folder.path, "plugin", ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "shared", license: "MIT" }),
      );
      fs.writeFileSync(
        path.join(folder.path, "plugin", ".mcp.json"),
        JSON.stringify({ test: { command: "node", env: { TOKEN: "$" + "{SECRET_TOKEN}" } } }),
      );
      fs.writeFileSync(
        path.join(folder.path, "plugin", "skills", "task", "SKILL.md"),
        `---\nname: task\ndescription: Task.\n---\n${content}.\n`,
      );
    }
    const a = await env.client.call("extensions.catalog_add", { source: first.path });
    const b = await env.client.call("extensions.catalog_add", { source: second.path });
    const installed = await env.client.call("extensions.install", { entry: { catalog: a.id, id: "shared" } });
    const key = installed.settings.find((s) => s.label === "Secret token")?.name;
    assert.ok(key);
    await env.client.call("extensions.settings", { id: "shared", values: { [key]: "synthetic-private-key" } });
    await assert.rejects(
      env.client.call("extensions.install", { entry: { catalog: b.id, id: "shared" } }),
      /already installed.*different source/i,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await first.remove();
    await second.remove();
  }
});

test("a reordered plugin update keeps two server credentials with their original variables", async () => {
  const catalog = tempDir("reorder-catalog-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.mkdirSync(path.join(catalog.path, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(catalog.path, "plugin", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(catalog.path, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "Acme",
        plugins: [{ name: "shared", source: "./plugin" }],
      }),
    );
    fs.writeFileSync(
      path.join(catalog.path, "plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "shared", license: "MIT" }),
    );
    const server = (variable: string) => ({
      command: process.execPath,
      args: [SERVER],
      env: { NOTES_TOKEN: `\${${variable}}` },
    });
    const first = server("SOME_SERVICE_ACCESS_TOKEN");
    const second = server("SOME_SERVICE_ACCESS_SECRET");
    const mcp = path.join(catalog.path, "plugin", ".mcp.json");
    fs.writeFileSync(mcp, JSON.stringify({ first, second }));
    const added = await env.client.call("extensions.catalog_add", { source: catalog.path });
    const installed = await env.client.call("extensions.install", { entry: { catalog: added.id, id: "shared" } });
    const token = installed.settings.find((s) => s.label === "Some service access token")?.name;
    const secret = installed.settings.find((s) => s.label === "Some service access secret")?.name;
    assert.ok(token && secret);
    await env.client.call("extensions.settings", {
      id: "shared",
      values: { [token]: "synthetic-first", [secret]: "synthetic-second" },
    });
    await env.client.call("extensions.enable", { id: "shared", enabled: true });
    const check = async () => {
      for (const [name, expected] of [
        ["first", "synthetic-first"],
        ["second", "synthetic-second"],
      ] as const) {
        const result = await env.client.call("mcp.call", {
          scope: "global",
          server: `shared-${name}`,
          tool: "token",
          arguments: {},
        });
        assert.match(String(result.content?.[0]?.text), new RegExp(expected));
      }
    };
    await check();
    fs.writeFileSync(mcp, JSON.stringify({ second, first }));
    await env.client.call("extensions.catalog_add", { source: catalog.path });
    await env.client.call("extensions.install", { entry: { catalog: added.id, id: "shared" } });
    await env.client.call("extensions.enable", { id: "shared", enabled: true });
    await check();
  } finally {
    await env.core.close();
    await env.cleanup();
    await catalog.remove();
  }
});

test("legacy catalog secrets are not silently reassigned during conversion updates", async () => {
  const catalog = tempDir("legacy-catalog-");
  const original = tempDir("legacy-extension-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(original.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "shared",
        name: "Shared",
        version: "1.0.0",
        settings: [{ name: "legacy_token", label: "Old API key", type: "string", sensitive: true }],
        mcp: { test: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://legacy_token" } } },
      }),
    );
    await env.client.call("extensions.install", { path: original.path });
    const legacy = env.core.store.extensions.get("shared");
    assert.ok(legacy);
    env.core.store.extensions.put({ ...legacy, source: "Acme · shared", origin_key: undefined });
    await env.client.call("extensions.settings", { id: "shared", values: { legacy_token: "synthetic-private-key" } });
    fs.mkdirSync(path.join(catalog.path, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(catalog.path, "plugin", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(catalog.path, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "Acme",
        plugins: [{ name: "shared", source: "./plugin" }],
      }),
    );
    fs.writeFileSync(
      path.join(catalog.path, "plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "shared", license: "MIT" }),
    );
    fs.writeFileSync(
      path.join(catalog.path, "plugin", ".mcp.json"),
      JSON.stringify({
        test: { command: "node", env: { TOKEN: "$" + "{SOME_SERVICE_ACCESS_TOKEN}" } },
      }),
    );
    const added = await env.client.call("extensions.catalog_add", { source: catalog.path });
    await assert.rejects(
      env.client.call("extensions.install", { entry: { catalog: added.id, id: "shared" } }),
      /different source/i,
    );
    const before = await env.client.call("extensions.list", {});
    assert.equal(
      before.extensions.find((e) => e.id === "shared")?.settings.find((s) => s.name === "legacy_token")?.set,
      true,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await original.remove();
    await catalog.remove();
  }
});

test("rolling back to a different source does not give it secrets set after replacement", async () => {
  const first = tempDir("rollback-first-");
  const second = tempDir("rollback-second-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    for (const [folder, name] of [
      [first, "First"],
      [second, "Second"],
    ] as const) {
      fs.writeFileSync(
        path.join(folder.path, "apx-extension.json"),
        JSON.stringify({
          manifest: 2,
          id: "rollback_source",
          name,
          version: "1.0.0",
          settings: [{ name: "token", label: "Token", type: "string", sensitive: true }],
          mcp: { test: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://token" } } },
        }),
      );
    }
    await env.client.call("extensions.install", { path: first.path });
    await env.client.call("extensions.install", { path: second.path });
    await env.client.call("extensions.settings", { id: "rollback_source", values: { token: "synthetic-private-key" } });
    await assert.rejects(env.client.call("extensions.rollback", { id: "rollback_source" }), /different source/i);
  } finally {
    await env.core.close();
    await env.cleanup();
    await first.remove();
    await second.remove();
  }
});

test("a different extension source cannot inherit the installed extension's secret", async () => {
  const first = tempDir("extension-first-");
  const second = tempDir("extension-second-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    for (const [folder, name] of [
      [first, "First"],
      [second, "Second"],
    ] as const) {
      fs.writeFileSync(
        path.join(folder.path, "apx-extension.json"),
        JSON.stringify({
          manifest: 2,
          id: "shared_id",
          name,
          version: "1.0.0",
          settings: [{ name: "token", label: "Token", type: "string", sensitive: true }],
          mcp: { test: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://token" } } },
        }),
      );
    }
    await env.client.call("extensions.install", { path: first.path });
    await env.client.call("extensions.settings", { id: "shared_id", values: { token: "synthetic-private-key" } });
    await assert.rejects(
      env.client.call("extensions.install", { path: second.path }),
      /already installed.*different source/i,
    );
    const installed = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "shared_id");
    assert.equal(installed?.name, "First");
    const current = path.join(first.path, "apx-extension.json");
    const updated = JSON.parse(fs.readFileSync(current, "utf8")) as { version: string };
    updated.version = "1.0.1";
    fs.writeFileSync(current, JSON.stringify(updated));
    const sameSource = await env.client.call("extensions.install", { path: first.path });
    assert.equal(sameSource.version, "1.0.1");
    assert.equal(sameSource.settings.find((s) => s.name === "token")?.set, true);
    fs.copyFileSync(current, path.join(second.path, "apx-extension.json"));
    await env.client.call("extensions.install", { path: second.path });
    updated.version = "1.0.2";
    fs.writeFileSync(path.join(second.path, "apx-extension.json"), JSON.stringify(updated));
    await assert.rejects(
      env.client.call("extensions.install", { path: second.path }),
      /already installed.*different source/i,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await first.remove();
    await second.remove();
  }
});
