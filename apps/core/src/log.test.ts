import assert from "node:assert/strict";
import { test } from "node:test";
import { createLog } from "./log.ts";

function logged(fields: Record<string, unknown>, msg = "x"): Record<string, unknown> {
  const lines: string[] = [];
  createLog("test", false, (l) => lines.push(l)).warn(fields, msg);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.endsWith("\n"));
  return JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
}

// Built from parts so the fixtures do not look like real keys to scanners.
const fake = (head: string, n: number) => `${head}${"Ab1".repeat(n).slice(0, n)}`;

test("credential shapes never reach the log, wherever they sit in a string", () => {
  const cases = [
    fake("sk-", 32),
    fake("sk-ant-api03-", 40),
    fake("ghp_", 36),
    fake("xoxb-", 24),
    fake("AIza", 35),
    `${fake("eyJ", 20)}.${fake("eyJ", 20)}.${fake("", 20)}`,
  ];
  for (const secret of cases) {
    const line = logged({ error: `request failed with ${secret} (401)` }, `calling with ${secret}`);
    assert.ok(!JSON.stringify(line).includes(secret), secret);
    assert.equal(line.error, "request failed with [redacted] (401)");
    assert.equal(line.msg, "calling with [redacted]");
  }
  const bot = fake("", 35);
  const tg = logged({ url: `https://api.telegram.org/bot123456789:${bot}/getUpdates` });
  assert.equal(tg.url, "https://api.telegram.org/bot[redacted]/getUpdates");
  const bearer = logged({ header: `Bearer ${fake("", 40)}` });
  assert.equal(bearer.header, "Bearer [redacted]");
  const query = logged({ url: `https://example.com/v1/models?key=${fake("", 20)}&alt=json` });
  assert.equal(query.url, "https://example.com/v1/models?key=[redacted]&alt=json");
});

test("fields named like secrets are redacted at any depth; references, counts and the rest stay", () => {
  const line = logged({
    token: "plain-but-secret",
    apiKey: "short",
    channel: { id: "tg", bot_token: "anything", headers: { Authorization: "Basic dXNlcjpwYXNz", cookie: "sid=1" } },
    password: "",
    key: "secret://telegram/tg",
    tokens_in: 1200,
    max_tokens: 4096,
    has_token: true,
    author: "Northwind",
    thread: "thr_123",
  });
  assert.equal(line.token, "[redacted]");
  assert.equal(line.apiKey, "[redacted]");
  assert.deepEqual(line.channel, {
    id: "tg",
    bot_token: "[redacted]",
    headers: { Authorization: "[redacted]", cookie: "[redacted]" },
  });
  assert.equal(line.password, "");
  assert.equal(line.key, "secret://telegram/tg");
  assert.equal(line.tokens_in, 1200);
  assert.equal(line.max_tokens, 4096);
  assert.equal(line.has_token, true);
  assert.equal(line.author, "Northwind");
  assert.equal(line.thread, "thr_123");
  assert.equal(line.level, "warn");
  assert.equal(line.scope, "test");
});

test("a quiet log writes nothing", () => {
  const lines: string[] = [];
  createLog("test", true, (l) => lines.push(l)).error({ token: "x" }, "boom");
  assert.equal(lines.length, 0);
});
