import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { schemaFields } from "./schema-fields.ts";

test("field factories stay cold through construction and derived object creation", () => {
  let constructed = 0;
  const direct = z.string();
  const original = z.object(
    schemaFields({
      direct,
      count: () => {
        constructed++;
        return z.number().int().min(1).default(2);
      },
    }),
  );
  const extended = original.extend(schemaFields({ extra: () => z.boolean().optional() }));
  const partial = original.partial();
  const strict = original.strict();
  assert.equal(constructed, 0);
  assert.ok(original instanceof z.ZodObject);
  assert.equal(extended.shape.count, original.shape.count);
  assert.equal(partial.shape.count.unwrap(), original.shape.count);
  assert.equal(strict.shape.count, original.shape.count);
  assert.equal(original.shape.direct, direct);
  assert.equal(constructed, 1);
  assert.deepEqual(strict.parse({ direct: "ok" }), { direct: "ok", count: 2 });
  assert.equal(strict.safeParse({ direct: "ok", count: 0 }).success, false);
  assert.equal(strict.safeParse({ direct: "ok", extra: true }).success, false);
  assert.equal(constructed, 1);
});

test("field factory errors are observable and never cached as success", () => {
  const failure = new Error("invalid field definition");
  let attempts = 0;
  const fields = schemaFields({
    value: () => {
      attempts++;
      throw failure;
    },
  });
  assert.equal(attempts, 0);
  assert.throws(() => fields.value, failure);
  assert.throws(() => fields.value, failure);
  assert.equal(attempts, 2);
});

test("deferred fields preserve refinements, default conversion and finite validation", () => {
  const schema = z
    .object(
      schemaFields({
        quantity: () => z.number().finite().min(0).default(2),
        label: () => z.string().trim().min(1),
      }),
    )
    .strict()
    .refine((value) => value.quantity !== 3, "Unavailable quantity");
  assert.deepEqual(schema.parse({ label: " Example " }), { quantity: 2, label: "Example" });
  assert.equal(schema.safeParse({ label: "Example", quantity: 3 }).success, false);
  assert.equal(schema.safeParse({ label: "Example", quantity: Number.POSITIVE_INFINITY }).success, false);
  const input = z.toJSONSchema(schema, { io: "input" });
  const output = z.toJSONSchema(schema, { io: "output" });
  assert.deepEqual(input.required, ["label"]);
  assert.deepEqual(output.required, ["quantity", "label"]);
});
