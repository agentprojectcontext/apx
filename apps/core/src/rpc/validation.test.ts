import assert from "node:assert/strict";
import { test } from "node:test";
import { createLog } from "../log.ts";
import type { CallContext } from "./context.ts";
import { createRouter, type Handlers } from "./router.ts";

const owner: CallContext = {
  role: "operator",
  actor: "human",
  transport: "internal",
  session: undefined,
  log: createLog("test", true),
  local: true,
};

test("invalid collections stop validation before traversing attacker-controlled elements", async () => {
  let reads = 0;
  let entered = false;
  const args = new Proxy(
    Array.from({ length: 100_000 }, () => null),
    {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const dispatch = createRouter(
    new Proxy<Partial<Handlers>>(
      {
        "mcp.set": () => {
          entered = true;
          throw new Error("invalid params reached handler");
        },
      },
      {},
    ) as Handlers,
  );
  const result = await dispatch(
    "mcp.set",
    { name: "test", server: { command: "unused", args } },
    owner,
    "invalid-array",
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "bad_request");
  assert.equal(entered, false);
  assert.ok(reads <= 1, `validation read ${reads} invalid elements`);
  assert.ok(JSON.stringify(result).length < 1024, "validation errors must not grow with the array");
});

test("valid params still receive schema defaults before the handler", async () => {
  let received: unknown;
  const dispatch = createRouter(
    new Proxy<Partial<Handlers>>(
      {
        "system.logs": (params) => {
          received = params;
          return { path: "test.log", exists: false, lines: [], scopes: [], more: false };
        },
      },
      {},
    ) as Handlers,
  );
  const result = await dispatch("system.logs", {}, owner);
  assert.equal(result.ok, true);
  assert.deepEqual(received, { limit: 300 });
});
