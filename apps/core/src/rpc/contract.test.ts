import assert from "node:assert/strict";
import { test } from "node:test";
import { type MethodName, methodAccess, methods } from "@apx/protocol";
import { createLog } from "../log.ts";
import type { CallContext } from "./context.ts";
import { createRouter, type Handlers } from "./router.ts";

const owner: CallContext = {
  role: "operator",
  actor: "human",
  transport: "internal",
  session: undefined,
  log: createLog("test", true),
};

function guardedRouter() {
  const entered: string[] = [];
  const handlers = new Proxy(
    {},
    {
      get: (_target, method) => () => {
        entered.push(String(method));
        throw new Error("invalid request reached a handler");
      },
    },
  ) as Handlers;
  return { dispatch: createRouter(handlers), entered };
}

test("every registered method rejects non-object params and unknown fields before entering a handler", async () => {
  const { dispatch, entered } = guardedRouter();
  for (const method of Object.keys(methods)) {
    for (const params of [[], { __unexpected_field: true }]) {
      const result = await dispatch(method, params, owner, `${method}-invalid`);
      assert.equal(result.ok, false, `${method} accepted ${JSON.stringify(params)}`);
      assert.equal(!result.ok && result.error.code, "bad_request", method);
    }
  }
  assert.deepEqual(entered, []);
});

test("every effect method requires its idempotency key before any handler runs", async () => {
  const { dispatch, entered } = guardedRouter();
  for (const [method, definition] of Object.entries(methods)) {
    if (!definition.effect) continue;
    const result = await dispatch(method, {}, owner);
    assert.equal(result.ok, false, method);
    assert.equal(!result.ok && result.error.code, "bad_request", method);
    assert.equal(!result.ok && result.error.message, `${method} requires an idempotency key`);
  }
  assert.deepEqual(entered, []);
});

test("every owner-only method rejects model clients before parsing params or entering a handler", async () => {
  const { dispatch, entered } = guardedRouter();
  for (const method of Object.keys(methods)) {
    if (methodAccess(method as MethodName) !== "human") continue;
    const result = await dispatch(method, [], { ...owner, actor: "agent" }, "key");
    assert.equal(result.ok, false, method);
    assert.equal(!result.ok && result.error.code, "unauthorized", method);
  }
  assert.deepEqual(entered, []);
});
