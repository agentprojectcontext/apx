// POST /api/engines/test — the one-shot connectivity probe behind the "test"
// button on a provider card. It must reach the adapter behind a provider SLUG,
// which is not always the adapter id (a provider named "carlos" can run on
// ollama), and it must not leak the model id into the prompt it sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(engines) {
  return buildApi({
    projects: new ProjectManager({}),
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, engines },
    token: "",
  });
}

const json = { "content-type": "application/json" };

async function post(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/engines/test`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("answers through a provider whose slug is not the adapter id", async () => {
  // The mock adapter echoes the last user message back, so the reply proves
  // both that the right adapter was reached and what was actually sent.
  const { server, baseUrl } = await listen(makeApp({ carlos: { engine: "mock" } }));
  try {
    const { status, body } = await post(baseUrl, {
      provider: "carlos",
      model: "mock",
      message: "hola carlos",
    });
    assert.equal(status, 200);
    assert.equal(body.provider, "carlos");
    assert.equal(body.model, "mock");
    assert.match(body.text, /hola carlos/);
    assert.equal(typeof body.ms, "number");
  } finally { server.close(); }
});

test("sends the same system prompt whatever the model is", async () => {
  // The point of the probe is that the model NAMES ITSELF. If the prompt
  // varied with the model id we would be feeding it the answer, and a provider
  // quietly serving something else would sail through.
  const { server, baseUrl } = await listen(makeApp({ mock: { engine: "mock" } }));
  const systemOf = (text) => text.match(/\(system: (.*)\)$/)?.[1];
  try {
    const a = await post(baseUrl, { provider: "mock", model: "model-one", message: "hi" });
    const b = await post(baseUrl, { provider: "mock", model: "model-two", message: "hi" });
    const sysA = systemOf(a.body.text);
    assert.ok(sysA, `no system fragment in ${a.body.text}`);
    assert.equal(sysA, systemOf(b.body.text));
    assert.doesNotMatch(sysA, /model-one|model-two/);
  } finally { server.close(); }
});

test("rejects a call with no provider or no model", async () => {
  const { server, baseUrl } = await listen(makeApp({ mock: { engine: "mock" } }));
  try {
    assert.equal((await post(baseUrl, { model: "mock" })).status, 400);
    assert.equal((await post(baseUrl, { provider: "mock" })).status, 400);
  } finally { server.close(); }
});

test("surfaces an adapter failure as 502, not a crash", async () => {
  const { server, baseUrl } = await listen(makeApp({}));
  try {
    const { status, body } = await post(baseUrl, { provider: "nope", model: "x", message: "hi" });
    assert.equal(status, 502);
    assert.match(body.error, /nope/);
  } finally { server.close(); }
});
