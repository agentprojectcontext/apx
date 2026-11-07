// A model app on this computer (Ollama-like): its OpenAI-compatible API on loopback, closed until a test opens it, so
// no other spec finds it. Its chats are answered by the fake model behind it.
import http from "node:http";
import type { AddressInfo } from "node:net";

const LOCAL_MODELS = ["llama3.2:3b", "nomic-embed-text:latest"];

export async function fakeLocalModels(llmUrl: string) {
  let open = false;
  let chats = 0;
  const server = http.createServer((req, res) => {
    if (!open) {
      res.writeHead(503).end();
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: LOCAL_MODELS.map((id) => ({ id, object: "model" })) }));
      return;
    }
    // Anything else (chat completions) goes to the fake model as it came.
    chats++;
    const target = new URL(`${llmUrl.replace(/\/v1$/, "")}${req.url}`);
    const out = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    out.on("error", () => res.writeHead(502).end());
    req.pipe(out);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    chats: () => chats,
    set: (on: boolean) => {
      open = on;
    },
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}
