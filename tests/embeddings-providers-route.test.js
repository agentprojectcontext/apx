// GET /embeddings/providers fills the whole Embeddings panel, and it must not
// make anyone wait on the network to see their own configuration.
//
// It used to `await` a real embedding call before answering anything. That was
// survivable while a failed call gave up after 4s; once the timeout grew to
// cover a cold model load (~6s), opening Settings meant six seconds of empty
// provider list. Config is config — it should never block on a probe.
//
// The second half is about honesty. The panel's "Local" badge was hardcoded on
// the Ollama row, so an install whose Ollama runs on another machine (the normal
// setup when the laptop has no GPU) was told its embedder was local — the one
// place the panel says anything about latency or where the text goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-embed-providers-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { createTokenStore } = await import("#host/daemon/token-store.js");
const { listAvailableEmbedEngines } = await import("#core/memory/embed-engines/index.js");

const TOKEN = "master-xyz";

async function listen() {
  const projects = new ProjectManager({});
  projects.registerDefault();
  const app = buildApi({
    projects,
    registries: null,
    plugins: { status: () => ({}), get: () => null },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
    tokenStore: createTokenStore({ masterToken: TOKEN }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("the provider list answers without waiting on an embedding call", async () => {
  const { server, baseUrl } = await listen();
  try {
    // A generous embedding timeout is the point of the cache: this config names
    // a host that does not answer, so a blocking probe would sit here for the
    // full timeout. The response must not.
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/api/embeddings/providers`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const ms = Date.now() - t0;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.engines) && body.engines.length,
      "the engine list is configuration and must always be there");
    assert.ok(ms < 4000, `the list waited ${ms}ms on a probe it should not wait for`);
    // A probe that has not landed yet is reported as empty, never guessed at.
    assert.equal(typeof body.active_embedder, "string");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an engine says where it runs, and only loopback counts as local", async () => {
  const remote = await listAvailableEmbedEngines({
    memory: { embeddings: { ollama: { base_url: "http://gpu-box.example:11434" } } },
  });
  const byId = Object.fromEntries(remote.map((e) => [e.id, e]));
  assert.equal(byId.ollama.local, false, "a box on the network is not local");
  assert.equal(byId.ollama.endpoint, "http://gpu-box.example:11434",
    "and the panel gets to show WHERE, because that is the useful part");

  const local = await listAvailableEmbedEngines({
    memory: { embeddings: { ollama: { base_url: "http://127.0.0.1:11434" } } },
  });
  assert.equal(local.find((e) => e.id === "ollama").local, true);

  // The offline embedder runs in-process — local by construction, no URL.
  assert.equal(local.find((e) => e.id === "tf").local, true);
  // A cloud API is never local and has no endpoint of its own to show.
  assert.equal(local.find((e) => e.id === "gemini").local, false);
});
