import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { relatedCut } from "../domain/memories.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** A fake Ollama: words about pets point one way, about coffee another, anything else a third. */
function vectorOf(text: string): number[] {
  if (/dog|perro|mascota|pet/i.test(text)) return [1, 0.1, 0];
  if (/coffee|café|cortado/i.test(text)) return [0, 1, 0.1];
  return [0.1, 0, 1];
}

let embedCalls = 0;
const ollama = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
    embedCalls++;
    const { input } = JSON.parse(raw) as { input: string[] };
    res.end(JSON.stringify({ embeddings: input.map(vectorOf) }));
  });
});

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  env = await startCore({ llm });
  const url = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
  await env.client.call("services.set", {
    id: "local",
    service: {
      kind: "embedding",
      dialect: "ollama-embed",
      label: "Ollama",
      base_url: url,
      enabled: true,
      needs_key: false,
      model: "bge-m3",
    },
  });
});
after(async () => {
  await env.core.close();
  await new Promise<void>((r) => ollama.close(() => r()));
  await env.cleanup();
});

test("by words only, a note sharing no word with the question is not found", async () => {
  await env.client.call("memory.add", { text: "Pancho is the owner's dog.", scope: "global" });
  await env.client.call("memory.add", { text: "The owner drinks a cortado every morning.", scope: "global" });
  const { memories } = await env.client.call("memory.list", { query: "mi mascota" });
  assert.equal(memories.length, 0);
});

test("by meaning, notes are indexed and the close one is found; edits are indexed again", async () => {
  await env.client.call("memory.set_settings", { mode: "semantic", auto_compact: true });
  const r = await env.client.call("memory.reindex", {});
  assert.equal(r.indexed, r.total);
  assert.equal(r.engine, "local/bge-m3");

  const { memories } = await env.client.call("memory.list", { query: "mi mascota" });
  assert.match(memories[0]?.text ?? "", /Pancho/);
  assert.ok(!memories.some((m) => /cortado/.test(m.text)), "the unrelated note stays out");

  const note = memories[0];
  if (!note) throw new Error("no note");
  await env.client.call("memory.add", { id: note.id, text: "Pancho the dog loves the beach.", scope: "global" });
  await new Promise((res) => setTimeout(res, 100));
  const s = await env.client.call("memory.settings", {});
  assert.equal(s.indexed, s.total, "the edited note was indexed again in the background");
});

test("when the engine is down, search goes on by words", async () => {
  await env.client.call("services.set", { id: "local", service: null });
  await env.client.call("services.set", {
    id: "gone",
    service: {
      kind: "embedding",
      dialect: "ollama-embed",
      label: "Gone",
      base_url: "http://127.0.0.1:9",
      enabled: true,
      needs_key: false,
    },
  });
  const { memories } = await env.client.call("memory.list", { query: "cortado morning" });
  assert.match(memories[0]?.text ?? "", /cortado/);
});

test("with memory off, the turn gets no notes and no memory tools", async () => {
  await env.client.call("memory.set_settings", { mode: "off", auto_compact: false });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  assert.doesNotMatch(String(call?.messages.at(-1)?.content), /\[memory/);
  assert.ok(!call?.tools.some((x) => ["remember", "recall", "forget"].includes(x.function.name)));
  assert.ok(embedCalls > 0);
});

test("with few notes and an engine that rates everything alike, only the close note comes back", () => {
  // Unrelated text at 0.6, the related note at 0.95: a fixed floor alone would bring both.
  assert.equal(relatedCut([0.95, 0.6]), 0.95 - 0.1);
  assert.equal(relatedCut([0.3]), 0.35, "the floor still holds");
  // Ten notes around 0.5 and one at 0.58: the median lifts the cut over the crowd.
  const crowd = [0.58, ...Array.from({ length: 10 }, (_, i) => 0.5 - i * 0.001)];
  assert.ok(relatedCut(crowd) > 0.5 && relatedCut(crowd) <= 0.58);
});
