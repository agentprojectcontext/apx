import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { recallChats } from "./chat-recall.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("automatic semantic recall finds an owner episode without shared words and excludes another agent", async () => {
  const embedded: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.end('{"models":[]}');
        return;
      }
      const input = JSON.parse(body).input as string[];
      embedded.push(...input);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ embeddings: input.map((text) => (text.includes("inventory") ? [0, 1, 0] : [1, 0, 0])) }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    const fact = "Presenting sketches requires plum-colored outlines.";
    const privateFact = "The unrelated supplier account is confidential.";
    for (const [agent, text] of [
      ["roby", fact],
      ["scout", privateFact],
    ] as const) {
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
      await env.client.call("threads.send", { thread: thread.id, text });
      await env.settle(thread.id);
    }
    await env.client.call("services.set", {
      id: "local",
      service: {
        kind: "embedding",
        dialect: "ollama-embed",
        label: "Local",
        enabled: true,
        needs_key: false,
        base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        model: "test-embedder",
      },
    });
    await env.client.call("memory.set_settings", { mode: "semantic", skill_picker: false, auto_compact: false });
    await env.client.call("memory.reindex", {});
    assert.ok(embedded.includes(fact));
    assert.ok(embedded.includes(privateFact));
    const target = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: target.id, text: "What hue fits our diagrams?" });
    await env.settle(target.id);
    const supplied = String(llm.calls.findLast((call) => call.tools.length > 0)?.messages.at(-1)?.content);
    assert.match(supplied, /plum-colored outlines/);
    assert.doesNotMatch(supplied, /supplier account/);
    const original = env.core.store.threads
      .list({ include_archived: false, limit: null })
      .find((t) => t.id !== target.id && t.agent_ids.includes("roby") && env.core.store.runs.list(t.id, 1).length);
    assert.ok(original);
    const originalRun = env.core.store.runs.list(original.id, 1)[0];
    assert.ok(originalRun);
    const sourceId = env.core.store.memorySources.forRun(originalRun.id)[0];
    assert.ok(sourceId);
    for (let n = 0; n < 9; n++) {
      await env.client.call("threads.send", {
        thread: original.id,
        text: `The inventory boxes belong to warehouse rack ${n}.`,
      });
      await env.settle(original.id);
    }
    await env.client.call("memory.reindex", {});
    const history = env.core.store.modelLog.list(original.id);
    env.core.store.threads.mergeContext(original.id, {
      compaction: {
        upto: history.at(-1)?.seq ?? 0,
        summary: "Earlier work was discussed.",
        untrusted: false,
        runs: 1,
        at: new Date().toISOString(),
      },
    });
    for (let n = 0; n < 2; n++) {
      await env.client.call("threads.send", { thread: original.id, text: "What hue fits our diagrams?" });
      await env.settle(original.id);
      const context = JSON.stringify(llm.calls.findLast((call) => call.tools.length > 0)?.messages);
      assert.equal(
        context.split(sourceId).length - 1,
        1,
        "compacted same-chat history is restored once, without re-injecting a visible source fragment",
      );
      assert.match(context, /plum-colored outlines/);
      assert.doesNotMatch(context, /supplier account/);
    }
  } finally {
    await env.core.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await env.cleanup();
  }
});

test("semantic search cannot return a note forgotten while the embedding call waits", async () => {
  let entered = () => {},
    release = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      if (req.url === "/api/tags") {
        res.end('{"models":[]}');
        return;
      }
      const input = JSON.parse(body).input as string[];
      if (input[0] === "Acme label") {
        entered();
        await waiting;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embeddings: input.map(() => [1, 0, 0]) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("services.set", {
      id: "local",
      service: {
        kind: "embedding",
        dialect: "ollama-embed",
        label: "Local",
        base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        enabled: true,
        needs_key: false,
        model: "test-embedder",
      },
    });
    await env.client.call("memory.set_settings", { mode: "semantic", skill_picker: true, auto_compact: false });
    const note = await env.client.call("memory.add", { scope: "global", text: "Acme label is violet." });
    const search = env.client.call("memory.list", { query: "Acme label" });
    await started;
    await env.client.call("memory.remove", { id: note.id });
    release();
    assert.equal((await search).memories.length, 0);
  } finally {
    release();
    await env.core.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await env.cleanup();
  }
});

test("a prepared own-chat snapshot rechecks forgotten sources and recall settings at render", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const index: MemoryIndex = {
    model: () => undefined,
    engine: () => undefined,
    schedule() {},
    stop: async () => {},
    index: async () => ({ indexed: 0, total: 0 }),
    search: async () => [],
    searchEpisodes: async () => [],
  };
  try {
    const a = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const fact = "Acme archives use violet labels.";
    await env.client.call("threads.send", { thread: a.id, text: fact });
    await env.settle(a.id);
    const b = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const snapshot = await recallChats(env.core.store, index, "roby", b, "Acme archives labels");
    assert.match(snapshot?.render() ?? "", /violet/);
    const settings = env.core.store.settings.read("memory");
    env.core.store.settings.write("memory", { ...settings, auto_recall: false });
    assert.equal(snapshot?.render(), undefined);
    env.core.store.settings.write("memory", { ...settings, auto_recall: true });
    const run = env.core.store.runs.list(a.id, 1)[0];
    assert.ok(run);
    const source = env.core.store.memorySources.forRun(run.id)[0];
    assert.ok(source);
    const note = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      text: fact,
      run_id: run.id,
      evidence: [{ message_id: source, quote: fact }],
    });
    await env.client.call("memory.remove", { id: note.id });
    assert.equal(snapshot?.render(), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
