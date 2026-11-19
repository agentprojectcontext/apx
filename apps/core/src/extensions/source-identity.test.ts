import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { mcpConfig } from "../mcp/config.ts";
import { tempDir } from "../testkit/platform.ts";
import { zipFiles } from "./zip.test-support.ts";

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
    assert.deepEqual(installed.source_catalog, { catalog: a.id, entry: "shared" });
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

test("an archive update in the same catalog preserves its secret across versioned URLs and rollback", async () => {
  const catalog = tempDir("archive-catalog-");
  const other = tempDir("archive-other-");
  const make = (version: string) =>
    zipFiles({
      "apx-extension.json": JSON.stringify({
        id: "archive_test",
        name: "Archive test",
        version,
        settings: [{ name: "token", label: "API key", type: "string", sensitive: true }],
      }),
    });
  const urls = new Map([
    ["https://example.com/archive-1.apxext", make("1.0.0")],
    ["https://example.com/archive-2.apxext", make("2.0.0")],
    ["https://other.example.com/archive-2.apxext", make("2.0.0")],
  ]);
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    extensionFetch: (async (url: string | URL) => {
      const data = urls.get(String(url));
      return data ? new Response(data) : new Response("missing", { status: 404 });
    }) as typeof fetch,
  });
  const index = (folder: string, version: string, url: string) =>
    fs.writeFileSync(
      path.join(folder, "index.json"),
      JSON.stringify({
        schema: 1,
        entries: [
          {
            kind: "extension",
            id: "archive_test",
            name: "Archive test",
            description: "Test.",
            versions: [{ version, archive: { url } }],
          },
        ],
      }),
    );
  try {
    index(catalog.path, "1.0.0", "https://example.com/archive-1.apxext");
    index(other.path, "2.0.0", "https://example.com/archive-2.apxext");
    const a = await env.client.call("extensions.catalog_add", { source: catalog.path });
    const b = await env.client.call("extensions.catalog_add", { source: other.path });
    await env.client.call("extensions.install", { entry: { catalog: a.id, id: "archive_test" } });
    await env.client.call("extensions.settings", { id: "archive_test", values: { token: "synthetic-secret" } });
    await assert.rejects(
      env.client.call("extensions.install", { entry: { catalog: b.id, id: "archive_test" } }),
      /different source/i,
    );
    index(catalog.path, "2.0.0", "https://other.example.com/archive-2.apxext");
    await env.client.call("extensions.catalog_add", { source: catalog.path });
    await assert.rejects(
      env.client.call("extensions.install", { entry: { catalog: a.id, id: "archive_test" } }),
      /different source/i,
    );
    index(catalog.path, "2.0.0", "https://example.com/archive-2.apxext");
    await env.client.call("extensions.catalog_add", { source: catalog.path });
    const updated = await env.client.call("extensions.install", { entry: { catalog: a.id, id: "archive_test" } });
    assert.equal(updated.version, "2.0.0");
    assert.equal(updated.settings.find((s) => s.name === "token")?.set, true);
    const rolled = await env.client.call("extensions.rollback", { id: "archive_test" });
    assert.equal(rolled.version, "1.0.0");
    assert.equal(rolled.settings.find((s) => s.name === "token")?.set, true);
  } finally {
    await env.core.close();
    await env.cleanup();
    await catalog.remove();
    await other.remove();
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

test("OAuth bridge state is scoped to each extension and server and removed on uninstall", async () => {
  const source = tempDir("oauth-isolation-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    for (const id of ["first_oauth", "second_oauth"]) {
      fs.writeFileSync(
        path.join(source.path, "apx-extension.json"),
        JSON.stringify({
          manifest: 2,
          id,
          name: id,
          version: "1.0.0",
          mcp: {
            one: {
              command: "npx",
              args: ["-y", "mcp-remote", "https://mcp.example.com"],
              env: { MCP_REMOTE_CONFIG_DIR: "/tmp/ignored" },
            },
            two: { command: "npx", args: ["-y", "mcp-remote", "https://mcp.example.com"] },
          },
        }),
      );
      await env.client.call("extensions.install", { path: source.path });
      await env.client.call("extensions.enable", { id, enabled: true });
    }
    const defs = mcpConfig(env.core.store)
      .global()
      .filter((d) => d.name.includes("_oauth-"));
    const dirs = defs.map((d) => d.env.MCP_REMOTE_CONFIG_DIR);
    assert.equal(defs.length, 4);
    assert.equal(new Set(dirs).size, 4);
    assert.ok(dirs.every((d) => d && d !== "/tmp/ignored"));
    const first = dirs[0];
    assert.ok(first);
    fs.mkdirSync(first, { recursive: true });
    fs.writeFileSync(path.join(first, "synthetic-token"), "synthetic-private-key");
    await env.client.call("extensions.remove", { id: "first_oauth" });
    assert.equal(fs.existsSync(first), false);
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

test("an orphaned secret prevents a different source from taking over an installed ID", async () => {
  const first = tempDir("orphan-first-");
  const second = tempDir("orphan-second-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const write = (folder: string, name: string, version: string, withSecret: boolean) => {
    fs.writeFileSync(
      path.join(folder, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "orphaned",
        name,
        version,
        settings: withSecret ? [{ name: "token", label: "Token", type: "string", sensitive: true }] : [],
        mcp: { test: { command: process.execPath, args: [SERVER] } },
      }),
    );
  };
  try {
    write(first.path, "First", "1.0.0", true);
    await env.client.call("extensions.install", { path: first.path });
    await env.client.call("extensions.settings", { id: "orphaned", values: { token: "synthetic-private-key" } });
    write(first.path, "First", "1.0.1", false);
    await env.client.call("extensions.install", { path: first.path });
    write(first.path, "First", "1.0.2", false);
    await env.client.call("extensions.install", { path: first.path });
    write(second.path, "Second", "1.0.3", false);
    await assert.rejects(env.client.call("extensions.install", { path: second.path }), /different source/i);
  } finally {
    await env.core.close();
    await env.cleanup();
    await first.remove();
    await second.remove();
  }
});

test("an update cannot claim a previously unindexed system credential", async () => {
  const source = tempDir("unindexed-credential-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const has = env.core.secrets.has;
  try {
    const file = path.join(source.path, "apx-extension.json");
    const manifest = {
      manifest: 2,
      id: "hidden",
      name: "Hidden",
      version: "1.0.0",
      settings: [] as unknown[],
      mcp: { test: { command: process.execPath, args: [SERVER] } },
    };
    fs.writeFileSync(file, JSON.stringify(manifest));
    await env.client.call("extensions.install", { path: source.path });
    env.core.secrets.has = (ref) => ref === "secret://ext-hidden-token" || has(ref);
    manifest.version = "1.0.1";
    manifest.settings = [{ name: "token", label: "Token", type: "string", sensitive: true }];
    fs.writeFileSync(file, JSON.stringify(manifest));
    await assert.rejects(env.client.call("extensions.install", { path: source.path }), /saved.*secret/i);
  } finally {
    env.core.secrets.has = has;
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

for (const bridge of [
  { command: "npx", args: ["-y", "mcp-remote", "https://mcp.example.com"] },
  { command: "npx", args: ["-y", "mcp-remote@0.1.0", "https://mcp.example.com"] },
  { command: "mcp-remote", args: ["https://mcp.example.com"] },
])
  test(`a different source cannot replace an OAuth bridge: ${bridge.command} ${bridge.args.join(" ")}`, async () => {
    const first = tempDir("oauth-first-");
    const second = tempDir("oauth-second-");
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
            id: "oauth_session",
            name,
            version: "1.0.0",
            mcp: { test: bridge },
          }),
        );
      }
      await env.client.call("extensions.install", { path: first.path });
      await assert.rejects(env.client.call("extensions.install", { path: second.path }), /different source/i);
    } finally {
      await env.core.close();
      await env.cleanup();
      await first.remove();
      await second.remove();
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
    await env.client.call("extensions.enable", { id: "shared_id", enabled: true });
    const received = async () => {
      const result = await env.client.call("mcp.call", {
        scope: "global",
        server: "shared_id-test",
        tool: "token",
        arguments: {},
      });
      return String(result.content?.[0]?.text);
    };
    assert.match(await received(), /token=synthetic-private-key/);
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
    await env.client.call("secrets.set", { name: "ext-shared_id-stale", value: "synthetic-old-setting" });
    await env.client.call("secrets.set", { name: "ext-shared_id-other-token", value: "synthetic-other-extension" });
    await env.client.call("extensions.remove", { id: "shared_id" });
    const names = (await env.client.call("secrets.list", {})).secrets.map((s) => s.name);
    assert.equal(names.includes("ext-shared_id-stale"), false);
    assert.equal(names.includes("ext-shared_id-other-token"), true);
    const reinstalled = await env.client.call("extensions.install", { path: second.path });
    assert.equal(reinstalled.settings.find((s) => s.name === "token")?.set, false);
    await env.client.call("extensions.enable", { id: "shared_id", enabled: true });
    assert.doesNotMatch(await received(), /synthetic-private-key/);
    await env.client.call("extensions.remove", { id: "shared_id" });
    await env.client.call("secrets.set", { name: "ext-shared_id-token", value: "synthetic-orphan" });
    await assert.rejects(env.client.call("extensions.install", { path: second.path }), /saved.*secret/i);
  } finally {
    await env.core.close();
    await env.cleanup();
    await first.remove();
    await second.remove();
  }
});
