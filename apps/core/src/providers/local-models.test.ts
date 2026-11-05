import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import type { LocalApp, ProviderConfig } from "../config.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { createCatalog } from "../models/catalog.ts";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createLocalModels, localModelIds } from "./local-models.ts";
import { providerRegistry } from "./registry.ts";

/** An OpenAI-compatible model app on loopback: lists `models` while `up`, or never answers when `hang`. */
async function fakeApp(models: string[]) {
  const state = { up: true, hang: false };
  const server = http.createServer((req, res) => {
    if (state.hang) return;
    if (!state.up || req.url !== "/v1/models") {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    state,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A port nothing listens on: a fake app opened and closed again. */
async function closedPort(): Promise<number> {
  const app = await fakeApp([]);
  await app.close();
  return app.port;
}

async function setup(apps: LocalApp[], builtIn: ProviderConfig[] = []) {
  const dir = tempDir("apx-local-models-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  let changes = 0;
  const local = createLocalModels({ store, apps, onChange: () => changes++ });
  const providers = providerRegistry(store, builtIn, local);
  const catalog = createCatalog({
    store,
    secrets: createSecrets(dir.path, "file", {}),
    providers: providers.active,
    home: dir.path,
    discover: local.discover,
    harnessLists: { claude: async () => [], codex: async () => [] },
    acpList: async () => [],
  });
  const engine = async (id: string) => (await catalog.list()).find((e) => e.id === id);
  return {
    store,
    local,
    providers,
    engine,
    changes: () => changes,
    async [Symbol.asyncDispose]() {
      db.close();
      await dir.remove();
    },
  };
}

test("a model app running on this computer is found and its chat models listed, with no setup", async () => {
  const app = await fakeApp(["llama3.2:latest", "nomic-embed-text:latest", "bge-m3:latest"]);
  await using env = await setup([{ id: "ollama", label: "Ollama", port: app.port }]);
  try {
    const ollama = await env.engine("ollama");
    assert.equal(ollama?.available, true);
    assert.equal(ollama?.local, true);
    assert.equal(ollama?.kind, "provider");
    assert.deepEqual(
      ollama?.models.map((m) => [m.id, m.chat]),
      [
        ["llama3.2:latest", true],
        ["nomic-embed-text:latest", false],
        ["bge-m3:latest", false],
      ],
    );
    // A model of it is a provider like any other: picked for an agent, it runs through the OpenAI-compatible path.
    const p = env.providers.active().find((x) => x.id === "ollama");
    assert.equal(p?.transport, "openai-chat");
    assert.equal(p?.base_url, `http://127.0.0.1:${app.port}/v1`);
    assert.equal(env.providers.has("ollama"), true);
    assert.equal(env.changes(), 1);

    // Closed, it stays offered with its models, shown as unavailable; opened again, it is available at once.
    app.state.up = false;
    const closed = await env.engine("ollama");
    assert.equal(closed?.available, false);
    assert.deepEqual(
      closed?.models.map((m) => m.id),
      ["llama3.2:latest", "nomic-embed-text:latest", "bge-m3:latest"],
    );
    assert.equal(env.providers.has("ollama"), true);
    app.state.up = true;
    assert.equal((await env.engine("ollama"))?.available, true);
  } finally {
    await app.close();
  }
});

test("an app that is not running is not offered, and nothing is told", async () => {
  await using env = await setup([{ id: "lmstudio", label: "LM Studio", port: await closedPort() }]);
  assert.equal(await env.engine("lmstudio"), undefined);
  assert.equal(env.providers.has("lmstudio"), false);
  await env.local.check.run(new Date());
  assert.equal(env.changes(), 0);
});

test("a server that does not answer in time counts as not running", async () => {
  const app = await fakeApp(["slow"]);
  app.state.hang = true;
  await using env = await setup([{ id: "lmstudio", label: "LM Studio", port: app.port }]);
  try {
    const started = performance.now();
    assert.equal(await env.engine("lmstudio"), undefined);
    assert.ok(performance.now() - started < 10_000);
  } finally {
    await app.close();
  }
});

test("an Ollama the owner set up by hand is not listed twice: their entry is the one found", async () => {
  const app = await fakeApp(["qwen3:8b"]);
  // Their own address for it says "localhost", the app is looked for at 127.0.0.1: one server all the same.
  await using env = await setup([{ id: "ollama", label: "Ollama", port: app.port }]);
  try {
    env.providers.set("my-ollama", {
      transport: "openai-chat",
      base_url: `http://localhost:${app.port}/v1`,
      key: "none",
      models: [],
      label: "Ollama",
      preset: "ollama",
    });
    const list = await (async () => {
      await env.engine("my-ollama");
      return env.providers.all();
    })();
    assert.deepEqual(
      list.map((p) => p.id),
      ["my-ollama"],
    );
    assert.equal(list[0]?.local, true);
    const mine = await env.engine("my-ollama");
    assert.equal(mine?.local, true);
    assert.deepEqual(
      mine?.models.map((m) => m.id),
      ["qwen3:8b"],
    );
  } finally {
    await app.close();
  }
});

test("an owner's provider under the app's id but elsewhere keeps it: the app found here is offered beside it", async () => {
  const app = await fakeApp(["llama3.2"]);
  await using env = await setup([{ id: "ollama", label: "Ollama", port: app.port }]);
  try {
    env.providers.set("ollama", {
      transport: "openai-chat",
      base_url: "http://gpu-box.example.test:11434/v1",
      key: "none",
      models: ["qwen3:32b"],
      label: "Ollama",
    });
    const theirs = await env.engine("ollama");
    assert.equal(theirs?.local, undefined);
    assert.deepEqual(
      theirs?.models.map((m) => m.id),
      ["qwen3:32b"],
    );
    const here = await env.engine("ollama-local");
    assert.equal(here?.local, true);
    assert.equal(here?.label, "Ollama");
    assert.deepEqual(
      here?.models.map((m) => m.id),
      ["llama3.2"],
    );
  } finally {
    await app.close();
  }
});

test("a found app the owner removes stays hidden while it runs", async () => {
  const app = await fakeApp(["llama3.2"]);
  await using env = await setup([{ id: "ollama", label: "Ollama", port: app.port }]);
  try {
    assert.ok(await env.engine("ollama"));
    env.providers.set("ollama", null);
    assert.equal(await env.engine("ollama"), undefined);
    assert.equal(env.providers.has("ollama"), false);
  } finally {
    await app.close();
  }
});

test("the background check tells when an app opens or closes, and asks only this computer", async () => {
  const asked: string[] = [];
  const app = await fakeApp(["llama3.2"]);
  await using env = await setup([{ id: "ollama", label: "Ollama", port: app.port }]);
  try {
    let changes = 0;
    const local = createLocalModels({
      store: env.store,
      apps: [{ id: "ollama", label: "Ollama", port: app.port }],
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        asked.push(String(url));
        return fetch(url, init);
      }) as typeof fetch,
      onChange: () => changes++,
    });
    await local.check.run(new Date());
    assert.equal(changes, 1, "found for the first time");
    await local.check.run(new Date());
    assert.equal(changes, 1, "still running: nothing new");
    app.state.up = false;
    await local.check.run(new Date());
    assert.equal(changes, 2, "closed");
    assert.ok(asked.length > 0 && asked.every((u) => u.startsWith("http://127.0.0.1:")));
  } finally {
    await app.close();
  }
  // An address off this computer is never asked.
  let fetched = false;
  await assert.rejects(
    localModelIds("http://192.168.1.20:11434/v1", (async () => {
      fetched = true;
      return new Response("{}");
    }) as unknown as typeof fetch),
  );
  assert.equal(fetched, false);
});
