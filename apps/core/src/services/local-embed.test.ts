import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { embeddingHandlers } from "../rpc/embeddings.ts";
import { createLocalEmbeddings, recommendEmbedder } from "./local-embed.ts";

/** An Ollama stand-in: two models pulled (one embeds), and a pull that streams its progress. */
async function fakeOllama() {
  const pulled = ["llama3.2:3b", "nomic-embed-text:latest"];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as { model?: string }) : {};
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.9.0" }));
      if (req.url === "/api/tags")
        return res.end(JSON.stringify({ models: pulled.map((name) => ({ name, size: 300 * 2 ** 20 })) }));
      if (req.url === "/api/show")
        return res.end(
          JSON.stringify({ capabilities: /embed|bge/.test(body.model ?? "") ? ["embedding"] : ["completion"] }),
        );
      if (req.url === "/api/pull") {
        res.write(`${JSON.stringify({ status: "pulling manifest" })}\n`);
        res.write(`${JSON.stringify({ status: "downloading", total: 100, completed: 40 })}\n`);
        setTimeout(() => {
          pulled.push(`${body.model}:latest`);
          res.end(`${JSON.stringify({ status: "success" })}\n`);
        }, 50);
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("Ollama here: its embedding models, the one that fits the machine, and pulling one sets it up", async () => {
  const ollama = await fakeOllama();
  const ready: string[] = [];
  try {
    const local = createLocalEmbeddings({ url: ollama.url, onReady: (m) => ready.push(m) });
    const h = embeddingHandlers(local, () => undefined);
    const now = await h["embeddings.local"]();
    assert.equal(now.ollama.running, true);
    assert.deepEqual(
      now.ollama.models.map((m) => m.name),
      ["nomic-embed-text:latest"],
    );
    assert.ok(["bge-m3", "embeddinggemma"].includes(now.recommended));

    // One already pulled is only set up; another is pulled first, then set up.
    await h["embeddings.install"]({ model: "nomic-embed-text" });
    assert.deepEqual(ready, ["nomic-embed-text"]);
    await h["embeddings.install"]({ model: "bge-m3" });
    const start = Date.now();
    while (!ready.includes("bge-m3") && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(ready, ["nomic-embed-text", "bge-m3"]);
    assert.equal(local.progress(), undefined);
  } finally {
    ollama.close();
  }
});

test("no Ollama here: it says so, and the recommendation follows the machine's memory", async () => {
  const local = createLocalEmbeddings({ url: "http://127.0.0.1:9", onReady: () => {} });
  assert.deepEqual(await local.state(), { url: "http://127.0.0.1:9", running: false, models: [] });
  assert.equal(recommendEmbedder(32), "bge-m3");
  assert.equal(recommendEmbedder(8), "embeddinggemma");
});
