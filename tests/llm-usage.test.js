// Every model call leaves a line.
//
// 2026-09-23: a ChatGPT plan was spent in under an hour, and a successful call
// left no trace anywhere — the only way to reconstruct why was counting a2a
// rows in the message ledgers. These pin the record that answers "which
// account, from which surface, for whom".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-llm-usage-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { recordLlmCall, flushLlmUsage, readLlmCalls, summarizeLlmUsage, tokensOf } =
  await import("#core/stores/llm-usage.js");
const { callEngine } = await import("#core/engines/index.js");

const today = () => new Date().toISOString().slice(0, 10);

test("token counts are read from every adapter's usage shape", () => {
  assert.deepEqual(tokensOf({ input_tokens: 5, output_tokens: 2 }), { input: 5, output: 2 });
  assert.deepEqual(tokensOf({ prompt_tokens: 7, completion_tokens: 3 }), { input: 7, output: 3 });
  assert.deepEqual(tokensOf(null), { input: 0, output: 0 });
});

test("a day's calls are summarized by account, surface and agent", async () => {
  const now = new Date("2026-01-02T11:30:00Z");
  recordLlmCall({ modelId: "chatgpt-codex:luna", ms: 900, ok: true, usage: { input_tokens: 100, output_tokens: 10 }, attribution: { channel: "a2a", agent: "magui", project: 1 }, now });
  recordLlmCall({ modelId: "chatgpt-codex:luna", ms: 50, ok: false, error: "codex-plus 429: The usage limit has been reached", attribution: { channel: "a2a", agent: "super_agent" }, now });
  recordLlmCall({ modelId: "zen:big-pickle", ms: 300, ok: true, usage: { input_tokens: 40, output_tokens: 4 }, attribution: { channel: "telegram" }, now: new Date("2026-01-02T09:00:00Z") });
  await flushLlmUsage();
  assert.equal(readLlmCalls("2026-01-02").length, 3);
  const s = summarizeLlmUsage("2026-01-02");
  assert.equal(s.total, 3);
  assert.equal(s.failed, 1);
  assert.deepEqual(s.byModel[0], { key: "chatgpt-codex:luna", calls: 2, failed: 1, in: 100, out: 10 });
  assert.equal(s.byChannel.find((g) => g.key === "a2a").calls, 2);
  assert.equal(summarizeLlmUsage("2026-01-02", { sinceHour: 11 }).total, 2, "--since narrows by UTC hour");
});

test("callEngine records success and failure, with the caller's attribution", async () => {
  const prevFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async () => {
    if (fail) return { ok: false, status: 429, text: async () => JSON.stringify({ detail: "The usage limit has been reached" }) };
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(ctl) {
      ctl.enqueue(enc.encode('data: {"type":"response.output_text.delta","delta":"ok"}\n' +
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1}}}\n'));
      ctl.close();
    } });
    return { ok: true, body, text: async () => "" };
  };
  // A fake ChatGPT login, the shape codex-plus-auth reads.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })}.sig`;
  const authPath = path.join(TMP_HOME, "auth.json");
  fs.writeFileSync(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: jwt, refresh_token: "r", account_id: "acct-1", id_token: "i" } }));
  const call = () => callEngine({
    modelId: "codex-plus:gpt-5.6-luna", system: "s", messages: [{ role: "user", content: "ping" }],
    config: { engines: { "codex-plus": { auth_path: authPath } } },
    attribution: { channel: "routine", agent: "ceo", project: 5 },
  });
  const before = readLlmCalls(today()).length;
  try {
    await call();
    fail = true;
    await assert.rejects(call(), /usage limit/);
  } finally {
    globalThis.fetch = prevFetch;
  }
  await flushLlmUsage();
  const rows = readLlmCalls(today()).slice(before);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].ok, rows[0].in, rows[0].channel, rows[0].agent, rows[0].project], [true, 3, "routine", "ceo", 5]);
  assert.equal(rows[1].ok, false);
  assert.match(rows[1].error, /usage limit/);
});

test("the test engine is never recorded", async () => {
  const before = readLlmCalls(today()).length;
  await callEngine({ modelId: "mock:test", system: "s", messages: [{ role: "user", content: "hola" }], config: {} });
  await flushLlmUsage();
  assert.equal(readLlmCalls(today()).length, before);
});
