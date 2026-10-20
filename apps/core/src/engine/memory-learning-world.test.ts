import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ToolContext } from "../tools/types.ts";
import { learningWorld } from "./memory-learning-world.ts";

const ctx = { agent: { slug: "learner" } } as ToolContext;
async function exercise(o: {
  missing?: boolean;
  report: Record<string, string | boolean>;
  inspect?: boolean;
  prepare?: boolean;
  format?: boolean;
  inspectAfterDelivery?: boolean;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-world-"));
  try {
    const world = learningWorld(dir, {
      id: 1,
      name: "Delivery",
      teach: [],
      ...(o.format ? {} : { asset: o.missing ? "missing" : "normal" }),
      queries: [{ text: "Deliver", expect: o.format ? { format: "csv" } : { verified: "true" } }],
    });
    const run = async (name: string, args: Record<string, unknown>) => {
      const t = world.tools.find((t) => t.name === name);
      assert.ok(t);
      return t.run(args, ctx);
    };
    world.evaluate();
    if (o.prepare) {
      const { routes } = JSON.parse(await run("inspect_routes", {}));
      await run("prepare_asset", { route: routes[0] });
    }
    if (o.inspect && !o.inspectAfterDelivery) await run("inspect_asset", {});
    await run("deliver_report", { report: o.report });
    if (o.inspectAfterDelivery) await run("inspect_asset", {});
    assert.ok(fs.readdirSync(dir).some((n) => n.startsWith("delivery-")));
    return world.evaluateDelivery(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("learning evaluation refuses negated formats and string success flags", async () => {
  assert.ok((await exercise({ format: true, report: { format: "not csv" } })).length);
  assert.ok((await exercise({ report: { verified: "true" } })).length);
  assert.ok((await exercise({ missing: true, prepare: true, inspect: true, report: { verified: true } })).length);
});

test("learning evaluation requires a real current artifact and a read after export", async () => {
  assert.ok((await exercise({ prepare: true, report: { verified: true } })).length);
  assert.ok((await exercise({ prepare: true, inspectAfterDelivery: true, report: { verified: true } })).length);
  assert.deepEqual(await exercise({ prepare: true, inspect: true, report: { verified: true } }), []);
  assert.deepEqual(await exercise({ format: true, report: { format: "CSV" } }), []);
});
