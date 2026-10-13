import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { reach } from "./reach.ts";
import type { ServiceConfig } from "./types.ts";

const heard: Array<Record<string, string | string[] | undefined>> = [];
const server = http.createServer((req, res) => {
  heard.push(req.headers);
  if (req.url === "/slow/api/tags") return; // never answers, like a firewall that drops packets
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({ models: [{ name: "qwen3:4b" }, { name: "embeddinggemma:300m" }, { name: "bge-m3:latest" }] }),
    );
  if (req.url === "/v1beta/models")
    return res.end(
      JSON.stringify({
        models: [
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    );
  res.statusCode = 401;
  res.end("{}");
});
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const svc = (s: Partial<ServiceConfig>): ServiceConfig => ({
  id: "x",
  kind: "embedding",
  dialect: "ollama-embed",
  label: "Ollama",
  base_url: base,
  enabled: true,
  needs_key: false,
  ...s,
});

test("an Ollama that answers lists its models, embedding ones first", async () => {
  assert.deepEqual(await reach(svc({}), "/api/tags", undefined), {
    ok: true,
    models: ["embeddinggemma:300m", "bge-m3", "qwen3:4b"],
  });
});

test("it says why a service cannot be used: no answer in time, nothing listening, a refused key", async () => {
  assert.deepEqual(await reach(svc({ base_url: `${base}/slow` }), "/api/tags", undefined, fetch, 300), {
    ok: false,
    problem: "timeout",
  });
  const closed = http.createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((r) => closed.close(() => r()));
  assert.equal((await reach(svc({ base_url: `http://127.0.0.1:${port}` }), "/api/tags", undefined)).problem, "refused");
  assert.deepEqual(await reach(svc({ dialect: "openai-embed" }), "/v1/models", "sk-bad"), {
    ok: false,
    problem: "key",
    detail: "HTTP 401",
  });
});

test("Gemini gets its key in its own header and lists only the models that embed", async () => {
  const r = await reach(svc({ dialect: "gemini-embed", needs_key: true }), "/v1beta/models", "g-key");
  assert.deepEqual(r, { ok: true, models: ["gemini-embedding-001"] });
  assert.equal(heard.at(-1)?.["x-goog-api-key"], "g-key");
  assert.equal(heard.at(-1)?.authorization, undefined);
});
