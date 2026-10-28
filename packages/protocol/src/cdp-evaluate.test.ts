import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { CdpPage, type CdpSend } from "./cdp.ts";

function page() {
  const calls: Array<{ method: string; params?: object }> = [];
  const send = (async (method: string, params?: object) => {
    calls.push({ method, params });
    try {
      const result: unknown = await runInNewContext((params as { expression: string }).expression, {});
      return { result: { value: result } };
    } catch (error) {
      return { result: {}, exceptionDetails: { text: String(error) } };
    }
  }) as CdpSend;
  return { page: new CdpPage(send, { selectAllModifiers: 0 }), calls };
}

test("JavaScript evaluation awaits expressions and returns JSON without handles", async () => {
  const { page: p, calls } = page();
  assert.deepEqual(await p.evaluate("Promise.resolve({answer: 42, bigint: 3n})"), {
    json: '{"answer":42,"bigint":"3"}',
  });
  assert.equal(calls[0]?.method, "Runtime.evaluate");
  const params = calls[0]?.params as { awaitPromise?: boolean; timeout?: number } | undefined;
  assert.equal(params?.awaitPromise, true);
  assert.equal(params?.timeout, 5000);
  assert.deepEqual(await p.evaluate("undefined"), { json: "null" });
});

test("JavaScript evaluation rejects errors, circular values and oversized results", async () => {
  const { page: p } = page();
  await assert.rejects(p.evaluate("throw new Error('no action')"), /no action/);
  await assert.rejects(p.evaluate("(() => {const x={};x.x=x;return x;})()"), /circular/i);
  await assert.rejects(p.evaluate("'x'.repeat(17000)"), /exceeds/);
  await assert.rejects(p.evaluate(" "), /script must contain/);
  await assert.rejects(p.evaluate("x".repeat(64001)), /script must contain/);
});

test("stalled JavaScript calls have a bounded client wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const p = new CdpPage((() => new Promise(() => {})) as CdpSend, { selectAllModifiers: 0 });
  const rejected = assert.rejects(p.evaluate("new Promise(() => {})"), /timed out/);
  t.mock.timers.tick(7000);
  await rejected;
});
