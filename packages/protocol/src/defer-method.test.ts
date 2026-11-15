import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { appMethods } from "./app-methods.ts";
import { deferMethod } from "./defer-method.ts";
import { methods, type Params, type ParsedParams, type Result } from "./methods.ts";

test("metadata is eager and schemas are independently memoized real Zod objects", () => {
  let input = 0;
  let output = 0;
  const method = deferMethod({
    params: () => {
      input++;
      return z.object({ count: z.number().int().default(2) }).strict();
    },
    result: () => {
      output++;
      return z.object({ ok: z.boolean() });
    },
    effect: true,
    access: "human",
    open: true,
    local: true,
    replay: false,
  });
  assert.equal(method.effect, true);
  assert.equal(method.access, "human");
  assert.equal(method.open, true);
  assert.equal(method.local, true);
  assert.equal(method.replay, false);
  assert.ok(Object.keys(method).includes("params"));
  assert.deepEqual([input, output], [0, 0]);
  const params = method.params;
  assert.ok(params instanceof z.ZodObject);
  assert.deepEqual(params.parse({}), { count: 2 });
  assert.equal(params.safeParse({ count: 1.5 }).success, false);
  assert.equal(params.safeParse({ extra: true }).success, false);
  assert.equal(params.shape.count.safeParse(4).success, true);
  assert.equal(method.params, params);
  assert.deepEqual([input, output], [1, 0]);
  assert.ok(method.result instanceof z.ZodObject);
  assert.equal(method.result.safeParse({ ok: "yes" }).success, false);
  assert.equal(method.result, method.result);
  assert.deepEqual([input, output], [1, 1]);
  assert.deepEqual(
    z.toJSONSchema(params, { io: "input" }),
    z.toJSONSchema(z.object({ count: z.number().int().default(2) }).strict(), { io: "input" }),
  );
});

test("factory errors remain observable and do not poison the other schema", () => {
  const failure = new Error("invalid schema definition");
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

test("all app methods expose memoized lazy schemas and keep the registry's exact entries", () => {
  assert.equal(Object.keys(appMethods).length, 273);
  for (const [name, definition] of Object.entries(appMethods)) {
    assert.equal(methods[name as keyof typeof appMethods], definition, name);
    for (const field of ["params", "result"] as const) {
      assert.equal(typeof Object.getOwnPropertyDescriptor(definition, field)?.get, "function", `${name}.${field}`);
      const schema = definition[field];
      assert.ok(schema instanceof z.ZodType, `${name}.${field}`);
      assert.equal(definition[field], schema, `${name}.${field} is memoized`);
      assert.equal(typeof schema.safeParse, "function");
    }
  }
});

test("method-specific input, parsed defaults, output and shape remain typed and validated", () => {
  const input: Params<"threads.list"> = {};
  const parsed: ParsedParams<"threads.list"> = methods["threads.list"].params.parse(input);
  const output: Result<"threads.list"> = { threads: [] };
  assert.ok(parsed);
  assert.deepEqual(methods["threads.list"].result.parse(output), { threads: [] });
  assert.equal(methods["tasks.update"].params.shape.description.safeParse("A task").success, true);
  assert.equal(
    methods["threads.create"].params.safeParse({ kind: "agent", agent_id: "example", extra: true }).success,
    false,
  );
});
