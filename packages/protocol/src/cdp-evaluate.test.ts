import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { CdpPage, type CdpSend } from "./cdp.ts";

const ORIGIN = "https://example.com";
function page() {
  const calls: Array<{ method: string; params?: object }> = [];
  const send = (async (method: string, params?: object) => {
    calls.push({ method, params });
    try {
      const result: unknown = await runInNewContext(
        `(${(params as { functionDeclaration: string }).functionDeclaration}).call(review)`,
        {
          location: { origin: ORIGIN },
          document: {},
          review: () => true,
        },
      );
      return { result: { value: result } };
    } catch (error) {
      return { result: {}, exceptionDetails: { text: String(error) } };
    }
  }) as CdpSend;
  return { page: new CdpPage(send, { selectAllModifiers: 0 }), calls };
}

test("JavaScript evaluation awaits expressions and returns JSON without handles", async () => {
  const { page: p, calls } = page();
  assert.deepEqual(await p.evaluate("Promise.resolve({answer: 42, bigint: 3n})", ORIGIN, "doc1"), {
    json: '{"answer":42,"bigint":"3"}',
  });
  assert.equal(calls[0]?.method, "Runtime.callFunctionOn");
  const params = calls[0]?.params as { awaitPromise?: boolean; objectId?: string } | undefined;
  assert.equal(params?.awaitPromise, true);
  assert.equal(params?.objectId, "doc1");
  assert.deepEqual(await p.evaluate("undefined", ORIGIN, "doc1"), { json: "null" });
  assert.deepEqual(await p.evaluate("42;", ORIGIN, "doc1"), { json: "42" });
  assert.deepEqual(await p.evaluate("this === globalThis", ORIGIN, "doc1"), { json: "true" });
  assert.deepEqual(await p.evaluate("await Promise.resolve(3)", ORIGIN, "doc1"), { json: "3" });
  assert.deepEqual(await p.evaluate("const answer = 42; return answer;", ORIGIN, "doc1"), { json: "42" });
  assert.deepEqual(await p.evaluate("const answer = 42;", ORIGIN, "doc1"), { json: "null" });
});

test("JavaScript evaluation rejects errors, circular values, oversized results and a changed origin", async () => {
  const { page: p } = page();
  await assert.rejects(p.evaluate("(() => {throw new Error('no action')})()", ORIGIN, "doc1"), /no action/);
  await assert.rejects(p.evaluate("(() => {const x={};x.x=x;return x;})()", ORIGIN, "doc1"), /circular/i);
  await assert.rejects(p.evaluate("'x'.repeat(17000)", ORIGIN, "doc1"), /exceeds/);
  await assert.rejects(p.evaluate(" ", ORIGIN, "doc1"), /script must contain/);
  await assert.rejects(p.evaluate("x".repeat(64001), ORIGIN, "doc1"), /script must contain/);
  await assert.rejects(
    p.evaluate("(() => {throw new Error('must not execute')})()", "https://northwind.example", "doc1"),
    /origin changed/,
  );
  await assert.rejects(p.evaluate("1", "https://example.com/path", "doc1"), /exact http/);
});

test("stalled JavaScript calls have a bounded client wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const p = new CdpPage((() => new Promise(() => {})) as CdpSend, { selectAllModifiers: 0 });
  const rejected = assert.rejects(p.evaluate("new Promise(() => {})", ORIGIN, "doc1"), /timed out/);
  t.mock.timers.tick(7000);
  await rejected;
});
