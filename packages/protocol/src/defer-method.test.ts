import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { methods } from "./methods.ts";

test("authorization metadata never constructs either independently memoized schema", () => {
  let inputs = 0;
  let outputs = 0;
  const method = deferMethod({
    params: () => {
      inputs++;
      return z.object({ count: z.number().int().default(2) }).strict();
    },
    result: () => {
      outputs++;
      return z.object({ ok: z.boolean() });
    },
    effect: true,
    access: "human",
    open: true,
    local: true,
    replay: false,
  });
  const { effect, access, open, local, replay } = method;
  assert.deepEqual(
    { effect, access, open, local, replay },
    { effect: true, access: "human", open: true, local: true, replay: false },
  );
  assert.ok(Object.keys(method).includes("params"));
  assert.deepEqual([inputs, outputs], [0, 0]);
  assert.ok(method.params instanceof z.ZodObject);
  assert.equal(method.params, method.params);
  assert.deepEqual(method.params.parse({}), { count: 2 });
  assert.equal(method.params.shape.count.safeParse(1.5).success, false);
  assert.equal(method.params.safeParse({ extra: true }).success, false);
  assert.deepEqual([inputs, outputs], [1, 0]);
  assert.ok(method.result instanceof z.ZodObject);
  assert.equal(method.result, method.result);
  assert.equal(method.result.safeParse({ ok: "yes" }).success, false);
  assert.deepEqual([inputs, outputs], [1, 1]);
});

test("failed method factories are not hidden or cached as success", () => {
  const failure = new Error("invalid method definition");
  let attempts = 0;
  const method = deferMethod({
    params: () => {
      attempts++;
      throw failure;
    },
    result: () => z.string(),
    effect: false,
  });
  assert.equal(method.effect, false);
  assert.equal(Object.hasOwn(method, "access"), false);
  assert.throws(() => method.params, failure);
  assert.throws(() => method.params, failure);
  assert.equal(attempts, 2);
  assert.equal(method.result.parse("ready"), "ready");
});

test("all registered methods keep real memoized Zod schemas behind native getters", () => {
  for (const [name, definition] of Object.entries(methods)) {
    for (const field of ["params", "result"] as const) {
      assert.equal(typeof Object.getOwnPropertyDescriptor(definition, field)?.get, "function", `${name}.${field}`);
      const schema = definition[field];
      assert.ok(schema instanceof z.ZodType, `${name}.${field}`);
      assert.equal(definition[field], schema, `${name}.${field} identity`);
    }
  }
});
