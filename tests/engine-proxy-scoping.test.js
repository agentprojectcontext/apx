// `engines.<id>.proxy` must move THAT provider's traffic and nothing else.
//
// The point of the setting is surgical egress: one model provider goes out
// through a tunnel while Telegram, the vault, the update check and every other
// engine stay on the default route. A process-wide switch (HTTPS_PROXY,
// NODE_USE_ENV_PROXY) cannot express that, which is why this is a per-request
// dispatcher instead.
//
// How the assertion works without a real tunnel: the engine's base_url points
// at a port nothing listens on, and the proxy answers on a live one. A call
// that SUCCEEDS therefore proves the request went through the proxy — there is
// no other way for it to have been answered. A call that fails with a
// connection error proves it did not.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOpenAiCompatibleEngine } from "../src/core/engines/openai-compatible.js";
import { closeProxyAgents } from "../src/core/net/proxy.js";

/**
 * A port nothing listens on: bind one, read it back, release it. The reserved
 * low ports would be simpler but fetch refuses them outright ("bad port"),
 * which would pass the negative tests for the wrong reason.
 */
const DEAD_ORIGIN = await (async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return `http://127.0.0.1:${port}/v1`;
})();

const COMPLETION = {
  choices: [{ message: { role: "assistant", content: "por el túnel" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 4 },
};

/**
 * A forward proxy that answers instead of forwarding. A proxied plain-HTTP
 * request arrives with the absolute URI in the request line, which is what
 * lets the test tell a proxied call from a direct one.
 */
async function startProxy() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(COMPLETION));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, server };
}

const engine = createOpenAiCompatibleEngine({
  id: "northwind",
  defaultBaseUrl: DEAD_ORIGIN,
  apiKeyEnv: "NORTHWIND_API_KEY",
});

const ask = (config) =>
  engine.chat({ messages: [{ role: "user", content: "hola" }], model: "nw-1", config });

test("a configured proxy carries the call to an origin that is otherwise unreachable", async (t) => {
  const proxy = await startProxy();
  t.after(async () => {
    proxy.server.close();
    await closeProxyAgents();
  });

  const out = await ask({ api_key: "k", base_url: DEAD_ORIGIN, proxy: proxy.url });

  assert.equal(out.text, "por el túnel");
  assert.equal(proxy.seen.length, 1, "the proxy saw exactly one request");
  assert.equal(
    proxy.seen[0],
    `${DEAD_ORIGIN}/chat/completions`,
    "a proxied request carries the absolute URI, proving it was not a direct call"
  );
});

test("without the setting the same call goes direct — no silent inheritance", async () => {
  await assert.rejects(
    ask({ api_key: "k", base_url: DEAD_ORIGIN }),
    (e) => /fetch failed|ECONNREFUSED|refused/i.test(e.message),
    "an engine with no proxy must take the default route even while another engine has one"
  );
});

test("one engine's proxy does not leak into another's", async (t) => {
  const proxy = await startProxy();
  t.after(async () => {
    proxy.server.close();
    await closeProxyAgents();
  });

  await ask({ api_key: "k", base_url: DEAD_ORIGIN, proxy: proxy.url });
  const before = proxy.seen.length;

  await assert.rejects(ask({ api_key: "k", base_url: DEAD_ORIGIN }));
  assert.equal(proxy.seen.length, before, "the unproxied engine never touched the tunnel");
});

test("a malformed proxy URL fails the call instead of leaking it out the plain interface", async () => {
  await assert.rejects(
    ask({ api_key: "k", base_url: DEAD_ORIGIN, proxy: "not-a-url" }),
    /invalid proxy URL/,
    "silently ignoring it would send the traffic exactly where the operator forbade"
  );
});
