import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import type { ProviderConfig } from "../config.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { NO_KEY } from "../providers/llm.ts";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createCatalog, fromProviderList } from "./catalog.ts";

test("the catalog asks each engine for its models, caches them and keeps the last good list on failure", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-catalog-"));
  const db = openDb(home);
  try {
    const store = createStore(db, createBus());
    const secrets = createSecrets(home, "file", {});
    secrets.set("g", "key");
    const providers: ProviderConfig[] = [
      { id: "g", transport: "openai-chat", base_url: "http://g.test", key: "secret://g", models: [] },
      { id: "nokey", transport: "openai-chat", base_url: "http://n.test", key: "secret://none", models: [] },
    ];
    let up = true;
    let calls = 0;
    const catalog = createCatalog({
      store,
      secrets,
      providers: () => providers,
      fetchImpl: (async () => {
        calls++;
        if (!up) return new Response("down", { status: 503 });
        return new Response(
          JSON.stringify({ data: [{ id: "models/g-pro" }, { id: "models/g-embedding-1" }, { id: "models/genie-4" }] }),
        );
      }) as unknown as typeof fetch,
      home: "/nonexistent",
      acpList: async (a) => (a.id === "opencode" ? [{ id: "zen/pickle", name: "Pickle", chat: true }] : []),
      harnessLists: {
        claude: async () => [{ id: "claude-x", name: "Claude X", chat: true }],
        codex: async () => {
          throw new Error("not installed");
        },
      },
    });
    // A list an older APX kept (fresh, but read before efforts existed) is asked again, not served for a day.
    store.settings.set(
      "catalog:claude",
      JSON.stringify({
        id: "claude",
        kind: "harness",
        label: "Claude Code",
        available: true,
        models: [{ id: "old", name: "Old", chat: true }],
        fetched_at: new Date().toISOString(),
      }),
    );
    const first = await catalog.list();
    const g = first.find((e) => e.id === "g");
    assert.equal(g?.access, "api");
    assert.deepEqual(
      g?.models.map((m) => [m.id, m.chat]),
      [
        ["g-pro", true],
        ["g-embedding-1", false],
        ["genie-4", false],
      ],
    );
    assert.equal(first.find((e) => e.id === "claude")?.models[0]?.id, "claude-x");
    assert.equal(first.find((e) => e.id === "codex")?.available, false);
    assert.match(first.find((e) => e.id === "nokey")?.detail ?? "", /no key/);
    await catalog.list();
    assert.equal(calls, 1, "served from the cache");
    up = false;
    const stale = await catalog.list(true);
    assert.equal(stale.find((e) => e.id === "g")?.models.length, 3);
    assert.equal(stale.find((e) => e.id === "g")?.models.find((m) => m.id === "genie-4")?.chat, false);
    assert.equal(g?.starter, "g-pro");
    assert.match(stale.find((e) => e.id === "g")?.detail ?? "", /could not refresh/);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a signed-in plan's models are asked to the plan with its sign-in, never read from a CLI", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-catalog-plan-"));
  const db = openDb(home);
  try {
    const store = createStore(db, createBus());
    const asked: Array<{ url: string; headers: Headers }> = [];
    const catalog = createCatalog({
      store,
      secrets: createSecrets(home, "file", {}),
      providers: () => [
        {
          id: "chatgpt",
          transport: "chatgpt-responses",
          base_url: "http://plan.test/codex",
          key: "oauth:plan",
          models: [],
        },
      ],
      fetchImpl: (async (url: string, init: RequestInit) => {
        asked.push({ url, headers: new Headers(init.headers) });
        return new Response(
          JSON.stringify({
            models: [
              { slug: "gpt-b", display_name: "GPT-B", priority: 2 },
              { slug: "gpt-a", display_name: "GPT-A", priority: 1, supported_reasoning_levels: [{ effort: "high" }] },
              { slug: "gpt-hidden", visibility: "hide" },
            ],
          }),
        );
      }) as unknown as typeof fetch,
      home: "/nonexistent",
      acpList: async () => [],
      harnessLists: {
        claude: async () => [],
        codex: async () => {
          throw new Error("the CLI is not asked for a plan's models");
        },
      },
      signIns: {
        "oauth:plan": {
          has: () => true,
          credentials: async () => ({ token: "tok", headers: { "chatgpt-account-id": "acct-1" } }),
        },
      },
    });
    const plan = (await catalog.list()).find((e) => e.id === "chatgpt");
    assert.equal(plan?.access, "plan");
    store.settings.set("catalog.v2:chatgpt", JSON.stringify({ ...plan, access: undefined }));
    const cached = (await catalog.list()).find((e) => e.id === "chatgpt");
    assert.equal(cached?.access, "plan", "old cached lists use the current credential type");
    assert.equal(asked.length, 1, "access classification does not force a network refresh");
    assert.deepEqual(
      plan?.models.map((m) => [m.id, m.efforts]),
      [
        ["gpt-a", ["high"]],
        ["gpt-b", undefined],
      ],
    );
    const call = asked.find((a) => a.url.startsWith("http://plan.test/codex/models?client_version="));
    assert.equal(call?.headers.get("authorization"), "Bearer tok");
    assert.equal(call?.headers.get("chatgpt-account-id"), "acct-1");
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("world model exclusion preserves each source's eligibility policy, including cached lists", async () => {
  const compatible = ["acme/omni-chat", "acme/image-chat", "acme/guard-chat"];
  const chatModels = compatible.map((id) => ({ id, name: id, chat: true }));
  const home = tempDir("apx-catalog-eligibility-");
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const config = { transport: "openai-chat" as const, key: NO_KEY, models: [] };
    const providers: ProviderConfig[] = [
      { ...config, id: "cached", base_url: "http://cached.test" },
      {
        ...config,
        id: "configured",
        base_url: "http://configured.test",
        models: ["genie-4", "acme/chat", ...compatible],
      },
      { ...config, id: "local", base_url: "http://127.0.0.1:1/v1", local: true },
    ];
    const previous = JSON.stringify({
      id: "cached",
      kind: "provider",
      label: "Cached",
      available: true,
      models: [
        { id: "genie-4", name: "Genie 4", chat: true },
        { id: "acme/chat", name: "Chat", chat: true },
        { id: "acme/no-tools", name: "No tools", chat: false },
        { id: "acme/omni-disabled", name: "Disabled", chat: false },
        ...chatModels,
      ],
      fetched_at: new Date().toISOString(),
    });
    store.settings.set("catalog.v2:cached", previous);
    const catalog = createCatalog({
      store,
      secrets: createSecrets(home.path, "file", {}),
      providers: () => providers,
      home: home.path,
      fetchImpl: (async (url) => {
        if (String(url).includes("cached.test")) throw new Error("offline");
        return new Response(JSON.stringify({ data: [{ id: "genie-4" }, { id: "acme/chat" }, ...chatModels] }));
      }) as typeof fetch,
      harnessLists: {
        claude: async () => [{ id: "genie-4", name: "Genie 4", chat: true }, ...chatModels],
        codex: async () => [],
      },
      acpList: async () => [
        { id: "genie-4", name: "Genie 4", chat: true },
        { id: "acme/chat", name: "Chat", chat: true },
        ...chatModels,
      ],
    });
    for (const refresh of [false, true]) {
      const engines = await catalog.list(refresh);
      for (const id of ["cached", "configured", "local", "acp:opencode"]) {
        const engine = engines.find((e) => e.id === id);
        assert.ok(engine, id);
        assert.equal(engine.models.find((m) => m.id === "genie-4")?.chat, false, `${id}: ${refresh}`);
        assert.equal(engine.models.find((m) => m.id === "acme/chat")?.chat, true, id);
        if (engine.kind === "provider") assert.equal(engine.starter, "acme/chat", id);
      }
      for (const id of ["cached", "configured", "acp:opencode", "claude"]) {
        const engine = engines.find((e) => e.id === id);
        assert.ok(engine, id);
        assert.equal(engine.models.find((m) => m.id === "genie-4")?.chat, false);
        for (const model of compatible) {
          assert.equal(engine.models.find((m) => m.id === model)?.chat, true, `${id}: ${model}, refresh=${refresh}`);
        }
      }
      for (const model of compatible) {
        assert.equal(engines.find((e) => e.id === "local")?.models.find((m) => m.id === model)?.chat, false);
        assert.equal(fromProviderList([{ id: model }])[0]?.chat, false);
      }
      const cached = engines.find((e) => e.id === "cached");
      assert.equal(cached?.models.find((m) => m.id === "acme/no-tools")?.chat, false);
      assert.equal(cached?.models.find((m) => m.id === "acme/omni-disabled")?.chat, false);
      if (refresh) assert.match(cached?.detail ?? "", /could not refresh/);
    }
    assert.equal(store.settings.get("catalog.v2:cached"), previous, "reading eligibility does not rewrite saved state");
  } finally {
    db.close();
    await home.remove();
  }
});

test("world simulation models stay listed without becoming agent models", () => {
  const list = fromProviderList([
    { id: "models/genie-4", display_name: "Genie 4" },
    { id: "google/genie-4" },
    { id: "genie-4-preview" },
    { id: "genie-4:latest" },
    { id: "acme/genie-assistant" },
    { id: "acme/my-genie-4" },
    { id: "acme/genie-4-chat" },
    { id: "genie-4b-chat", supported_parameters: ["tools"] },
    { id: "models/gemini-4-neon" },
  ]);
  assert.deepEqual(
    list.map((m) => [m.id, m.chat]),
    [
      ["genie-4", false],
      ["google/genie-4", false],
      ["genie-4-preview", true],
      ["genie-4:latest", true],
      ["acme/genie-assistant", true],
      ["acme/my-genie-4", true],
      ["acme/genie-4-chat", true],
      ["genie-4b-chat", true],
      ["gemini-4-neon", true],
    ],
  );
  assert.equal(list[0]?.name, "Genie 4");
});

test("embedding discovery does not reinterpret configured, harness or cached eligibility", async () => {
  const home = tempDir("apx-catalog-embedding-policy-");
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const models = ["bge-m3", "voyage-4", "voyage-code-4"];
    const reported = models.map((id) => ({ id, name: id, chat: true }));
    const previous = JSON.stringify({
      id: "cached",
      kind: "provider",
      label: "Cached",
      available: true,
      models: reported,
      fetched_at: new Date().toISOString(),
    });
    store.settings.set("catalog.v2:cached", previous);
    const catalog = createCatalog({
      store,
      secrets: createSecrets(home.path, "file", {}),
      home: home.path,
      providers: () => [
        { id: "cached", transport: "openai-chat", base_url: "http://cached.test", key: NO_KEY, models: [] },
        { id: "configured", transport: "openai-chat", base_url: "http://configured.test", key: NO_KEY, models },
      ],
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
      harnessLists: { claude: async () => reported, codex: async () => [] },
      acpList: async () => [],
    });
    for (const refresh of [false, true]) {
      const engines = await catalog.list(refresh);
      for (const id of ["cached", "configured", "claude"]) {
        assert.deepEqual(engines.find((e) => e.id === id)?.models, reported, `${id}, refresh=${refresh}`);
      }
      assert.equal(store.settings.get("catalog.v2:cached"), previous);
    }
  } finally {
    db.close();
    await home.remove();
  }
});

test("discovered BGE M3 and Voyage 4 embeddings stay listed without being offered for agents", () => {
  const embeddings = ["bge-m3", "BAAI/bge-m3", "bge-m3:latest", "voyage-4", "voyageai/voyage-4", "voyage-code-4"];
  const chat = ["acme/voyage-assistant", "acme/voyage-4-chat", "acme/bge-m3-chat", "acme/my-voyage-4"];
  const list = fromProviderList([...embeddings, ...chat].map((id) => ({ id })));
  assert.deepEqual(
    list.map((m) => m.id),
    [...embeddings, ...chat],
  );
  assert.deepEqual(
    list.filter((m) => !m.chat).map((m) => m.id),
    embeddings,
  );
  assert.deepEqual(
    list.filter((m) => m.chat).map((m) => m.id),
    chat,
  );
});

test("only models an agent's turn can run on are offered for agents; switched-off ones are left out", () => {
  const list = fromProviderList([
    { id: "models/gemini-4-argon", display_name: "Gemini 4 Argon" },
    { id: "models/gemini-3.8-live" },
    { id: "models/lyria-3.5" },
    { id: "models/gemini-decision-1" },
    { id: "ollama/x/flux2-klein:latest" },
    { id: "acme/flux2-chat" },
    { id: "acme/decision-assistant" },
    { id: "models/deep-research-preview-04-2026" },
    { id: "meta-llama/llama-prompt-guard-2-22m" },
    { id: "canopylabs/orpheus-v1-english" },
    { id: "qwen/qwen3.6-27b", active: false },
    { id: "openai/gpt-oss-120b", active: true },
    { id: "acme/chat-no-tools", name: "Acme: Chat", supported_parameters: ["temperature"] },
    {
      id: "acme/chat-tools",
      supported_parameters: ["tools", "temperature"],
      architecture: { output_modalities: ["text"] },
    },
    { id: "acme/painter", supported_parameters: ["tools"], architecture: { output_modalities: ["image"] } },
  ]);
  assert.deepEqual(
    list.filter((m) => m.chat).map((m) => m.id),
    ["gemini-4-argon", "acme/flux2-chat", "acme/decision-assistant", "openai/gpt-oss-120b", "acme/chat-tools"],
  );
  assert.ok(!list.some((m) => m.id === "qwen/qwen3.6-27b"));
  assert.equal(list.find((m) => m.id === "acme/chat-no-tools")?.name, "Acme: Chat");
});
