import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createStderrLogs } from "./logs.ts";

test("stderr logs keep the last lines, join split writes, mask secrets and cut long lines", async () => {
  const logs = createStderrLogs({ lines: 3, lineChars: 20 });
  const stream = new PassThrough();
  logs.follow("a", stream, ["hunter22", "no"]);
  stream.write("one\ntw");
  stream.write("o\n\n\u001b[31mred\u001b[0m with hunter22\r\nfour\n");
  stream.end(`${"x".repeat(30)} no end`);
  await new Promise((r) => stream.on("end", r));
  assert.deepEqual(
    logs.read("a", 10).map((l) => l.text),
    ["red with •••", "four", `${"x".repeat(20)}…`],
  );
  assert.deepEqual(
    logs.read("a", 1).map((l) => l.text),
    [`${"x".repeat(20)}…`],
  );
  logs.forget((k) => k === "a");
  assert.deepEqual(logs.read("a", 10), []);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("mcp.logs shows what a server printed before it failed, with its secret masked", async () => {
  await env.client.call("secrets.set", { name: "noisy", value: "s3cret-value" });
  // A server that prints its token and a hint, then quits before answering.
  const script =
    "console.error('starting with ' + process.env.NOISY_TOKEN); console.error('missing config'); process.exit(1)";
  await env.client.call("mcp.set", {
    name: "noisy",
    server: { command: process.execPath, args: ["-e", script], env: { NOISY_TOKEN: "secret://noisy" } },
  });
  assert.deepEqual((await env.client.call("mcp.logs", { scope: "global", server: "noisy" })).lines, []);
  const r = await env.client.call("mcp.test", { scope: "global", server: "noisy" });
  assert.equal(r.ok, false);
  let lines: string[] = [];
  for (let i = 0; i < 50 && lines.length < 2; i++) {
    lines = (await env.client.call("mcp.logs", { scope: "global", server: "noisy" })).lines.map((l) => l.text);
    if (lines.length < 2) await new Promise((res) => setTimeout(res, 20));
  }
  assert.deepEqual(lines, ["starting with •••", "missing config"]);
  assert.deepEqual(
    (await env.client.call("mcp.logs", { scope: "global", server: "noisy", lines: 1 })).lines.map((l) => l.text),
    ["missing config"],
  );
  await assert.rejects(env.client.call("mcp.logs", { scope: "global", server: "nobody" }), /not found/);
  // A removed server's log goes with it.
  await env.client.call("mcp.set", { name: "noisy", server: null });
  await env.client.call("mcp.set", { name: "noisy", server: { command: process.execPath, args: ["-e", script] } });
  assert.deepEqual((await env.client.call("mcp.logs", { scope: "global", server: "noisy" })).lines, []);
});
