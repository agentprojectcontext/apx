import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowBinding } from "../../../../packages/protocol/src/flow-graph.ts";
import { evalFlowExpr, FlowExprError, flowExprBindings, flowTruthy, parseFlowExpr } from "./flow-expr.ts";
import { resolveFlowBinding } from "./flow-graph-validate.ts";

const vars = new Map([
  ["tier", "set"],
  ["limit", "set"],
]);
const payload = { tier: "gold", amount: 120, tags: ["vip", "new"], person: { name: " Alex ", email: "a@example.com" } };
const outputs = new Map<string, unknown>([
  ["set", { tier: "gold", limit: 100 }],
  ["read", { rows: [{ n: 3 }] }],
]);
const resolve = (b: FlowBinding) => resolveFlowBinding(b, payload, outputs);
const run = (src: string) => evalFlowExpr(parseFlowExpr(src), resolve, vars);

test("expressions compare, combine and compute over what arrived, earlier steps and variables", () => {
  assert.equal(run(`$trigger.tier == "gold"`), true);
  assert.equal(run(`$trigger.amount > $vars.limit && contains($trigger.tags, "vip")`), true);
  assert.equal(run(`$trigger.amount >= 200 || $vars.tier == 'silver'`), false);
  assert.equal(run(`not ($trigger.amount < 100) and $trigger.tier != "basic"`), true);
  assert.equal(run(`$steps.read.rows[0].n * 2 + 1`), 7);
  assert.equal(run(`$trigger.amount % 7`), 1);
  assert.equal(run(`lower(trim($trigger.person.name)) + "!"`), "alex!");
  assert.equal(run(`len($trigger.tags) == 2 ? "two" : "other"`), "two");
  assert.equal(run(`$trigger.missing.deeper || "none"`), "none");
  assert.equal(run(`exists($trigger.person.phone)`), false);
  assert.equal(run(`round(10 / 3, 2)`), 3.33);
  assert.equal(run(`number("4,5") + 1`), 5.5);
  assert.equal(run(`max(1, $trigger.amount, 3)`), 120);
  assert.equal(run(`join($trigger.tags, " | ")`), "vip | new");
  assert.equal(run(`$trigger.amount / 0`), null);
  assert.equal(run(`"a" < 1`), false);
  assert.deepEqual(run(`[1, "x", true]`), [1, "x", true]);
  // A field named like an operator word is still a field.
  assert.equal(
    evalFlowExpr(parseFlowExpr(`$trigger.not`), () => ({ not: 5 }), vars),
    5,
  );
});

test("an expression is data only: no code, no prototype, no names it was not given", () => {
  for (const src of [
    `constructor`,
    `this`,
    `process.env`,
    `require("fs")`,
    `$trigger.constructor.constructor("return process")()`,
    `$trigger["constructor"]`,
    `$env.HOME`,
    `$steps[$trigger.which]`,
    `eval("1")`,
    `x = 1`,
    "`template`",
  ]) {
    let value: unknown;
    try {
      value = run(src);
    } catch (err) {
      assert.ok(err instanceof FlowExprError, `${src}: ${String(err)}`);
      continue;
    }
    // What parses can only read data: a prototype field is null, never a function.
    assert.equal(value, null, src);
  }
  assert.equal(run(`$trigger.__proto__`), null);
  assert.equal(run(`$trigger.tags.length`), null);
  assert.equal(run(`$trigger.tags["0"]`), "vip");
});

test("expressions are bounded: length, nesting, text growth; and say which steps and variables they read", () => {
  assert.throws(() => parseFlowExpr("1+".repeat(600)), /too long/);
  assert.throws(() => parseFlowExpr(`${"(".repeat(40)}1${")".repeat(40)}`), /too deep/);
  assert.throws(() => parseFlowExpr(`"open`), /not closed/);
  assert.throws(() => parseFlowExpr(`$vars`), /too soon/);
  assert.throws(() => parseFlowExpr(`len(1, 2)`), /takes 1/);
  const big = new Map<string, unknown>([["set", { tier: "x".repeat(20000) }]]);
  assert.throws(
    () => evalFlowExpr(parseFlowExpr(`$vars.tier + $vars.tier`), (b) => resolveFlowBinding(b, null, big), vars),
    /too long/,
  );
  assert.deepEqual(flowExprBindings(parseFlowExpr(`$trigger.a == $steps["my-step"].b && $vars.limit > 1`), vars), [
    { kind: "event", path: [] },
    { kind: "node", node: "my-step", path: [] },
    { kind: "node", node: "set", path: ["limit"] },
  ]);
  assert.throws(() => flowExprBindings(parseFlowExpr(`$vars.nobody`), vars), /No step sets/);
  assert.deepEqual([0, "", null, false, undefined, [], {}, "0"].map(flowTruthy), [
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    true,
  ]);
});
