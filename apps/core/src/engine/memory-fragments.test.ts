import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("a topic inside a long owner message is recalled by a persisted fragment, once per source", async () => {
  const topic = "Northwind questionnaires ask about onboarding and notification choices.";
  const query = "Can participants tap responses in that feedback form?";
  const mixed = `Warehouse: ${query}`;
  const embedded: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/tags") {
        res.end('{"models":[]}');
        return;
      }
      const { input } = JSON.parse(body) as { input: string[] };
      embedded.push(...input);
      res.end(
        JSON.stringify({
          embeddings: input.map((text) =>
            text === query || text === mixed || (text.length <= 800 && text.includes(topic)) ? [1, 0, 0] : [0, 1, 0],
          ),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const llm = scriptedLlm(() => say("Acknowledged."));
  const env = await startCore({ llm });
  let closed = false;
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Planning" });
    const text = `${"Warehouse shelf labels need routine maintenance. ".repeat(25)}\n${topic}\n${"Weather station reports remain archived. ".repeat(35)}`;
    await env.client.call("threads.send", { thread: thread.id, text });
    await env.settle(thread.id);
    const run = env.core.store.runs.list(thread.id, 1)[0];
    assert.ok(run);
    const source = env.core.store.memorySources.forRun(run.id)[0];
    assert.ok(source);
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
    const chunks = embedded.filter((part) => text.includes(part));
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((part) => part.length <= 800));
    assert.equal(
      env.core.store.memoryWork.searchEpisodes(query, [thread.id]).length,
      0,
      "the original source shares no lexical match with this question",
    );
    await env.core.close();
    closed = true;
    const restarted = await startCore({ home: env.home, llm });
    try {
      assert.ok(
        restarted.core.store.memoryWork.searchEpisodes(mixed, [thread.id]).length,
        "the mixed query also finds the original source by a generic word outside the relevant fragment",
      );
      for (const text of [query, mixed]) {
        const target = await restarted.client.call("threads.create", { kind: "loose", agent_id: "roby" });
        await restarted.client.call("threads.send", { thread: target.id, text });
        await restarted.settle(target.id);
        const context = String(llm.calls.at(-1)?.messages.at(-1)?.content);
        assert.equal(context.split(source).length - 1, 1, "multiple matching fragments yield one original message");
        assert.match(context, /Northwind questionnaires/, "the matching fragment must survive the source excerpt cap");
      }
    } finally {
      await restarted.core.close();
    }
  } finally {
    if (!closed) await env.core.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await env.cleanup();
  }
});
