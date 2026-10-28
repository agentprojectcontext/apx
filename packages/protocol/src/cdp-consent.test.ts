import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend } from "./cdp.ts";

function fixture() {
  const calls: Array<{ method: string; params?: object }> = [];
  let failure = false;
  const send = (async (method: string, params?: object) => {
    calls.push({ method, params });
    if (method === "Runtime.evaluate") return { result: { objectId: "doc1" } };
    if (method === "Accessibility.getFullAXTree") return { nodes: [] };
    if (method !== "Runtime.callFunctionOn") return {};
    return failure ? { result: {}, exceptionDetails: { text: "document changed" } } : { result: { value: "null" } };
  }) as CdpSend;
  return {
    page: new CdpPage(send, { selectAllModifiers: 0 }),
    calls,
    stale: () => {
      failure = true;
    },
  };
}

const origin = "https://example.com";

test("browser consent identity stays stable within a page and cannot follow navigation or tab reuse", async () => {
  const { page, calls } = fixture();
  await page.snapshot(1000);
  calls.length = 0;
  const first = await page.approvalContext(origin, "doc1");
  assert.deepEqual(await page.approvalContext(origin, "doc1"), first);
  await page.evaluate("42", origin, "doc1", first.epoch);
  assert.equal(calls.length, 3);
  page.forget();
  assert.throws(() => page.evaluate("42", origin, "doc1", first.epoch), /permission expired/);
  assert.equal(calls.length, 3, "a stale permission must not send source to Chromium");
  await assert.rejects(page.approvalContext(origin, "doc1"), /review changed/);
  await page.snapshot(1000);
  assert.notEqual((await page.approvalContext(origin, "doc1")).epoch, first.epoch);
  const replacement = fixture().page;
  await replacement.snapshot(1000);
  assert.notEqual((await replacement.approvalContext(origin, "doc1")).epoch, first.epoch);
});

test("a stale review document cannot obtain a browser consent identity", async () => {
  const { page, stale } = fixture();
  await page.snapshot(1000);
  stale();
  await assert.rejects(page.approvalContext(origin, "doc1"), /document changed/);
});

test("navigation during consent validation refuses the old context", async () => {
  const reply = Promise.withResolvers<{ result: { value: string } }>();
  const send = (async (method: string) => {
    if (method === "Runtime.evaluate") return { result: { objectId: "doc1" } };
    if (method === "Accessibility.getFullAXTree") return { nodes: [] };
    return method === "Runtime.callFunctionOn" ? reply.promise : {};
  }) as CdpSend;
  const page = new CdpPage(send, { selectAllModifiers: 0 });
  await page.snapshot(1000);
  const result = page.approvalContext(origin, "doc1");
  page.forget();
  const rejected = assert.rejects(result, /permission expired/);
  reply.resolve({ result: { value: "null" } });
  await rejected;
});
