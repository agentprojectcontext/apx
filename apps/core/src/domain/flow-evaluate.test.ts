import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesFlowPredicates } from "./flow-evaluate.ts";

test("flow predicates use strict comparisons on own properties", () => {
  const data = { event: { type: "comment", count: 1 } };
  assert.equal(matchesFlowPredicates(data, [{ path: ["event", "type"], equals: "comment" }]), true);
  assert.equal(matchesFlowPredicates(data, [{ path: ["event", "count"], equals: "1" }]), false);
  assert.equal(matchesFlowPredicates(data, [{ path: ["missing"], equals: null }]), false);
  assert.equal(matchesFlowPredicates(Object.create({ hidden: true }), [{ path: ["hidden"], equals: true }]), false);
});

test("invalid predicate paths and excessive counts are rejected even after a nonmatch", () => {
  assert.throws(
    () =>
      matchesFlowPredicates({}, [
        { path: ["missing"], equals: true },
        { path: ["__proto__"], equals: null },
      ]),
    /Invalid/,
  );
  assert.throws(() => matchesFlowPredicates({}, [{ path: [], equals: null }]), /Invalid/);
  assert.throws(
    () =>
      matchesFlowPredicates(
        {},
        Array.from({ length: 33 }, () => ({ path: ["x"], equals: null })),
      ),
    /Too many/,
  );
});
