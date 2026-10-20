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
  await assert.rejects(() => exercise({ format: true, report: { format: "not csv" } }), /Unsupported delivery format/);
  assert.ok((await exercise({ report: { verified: "true" } })).length);
  assert.ok((await exercise({ missing: true, prepare: true, inspect: true, report: { verified: true } })).length);
});

test("learning evaluation requires a real current artifact and a read after export", async () => {
  assert.ok((await exercise({ prepare: true, report: { verified: true } })).length);
  assert.ok((await exercise({ prepare: true, inspectAfterDelivery: true, report: { verified: true } })).length);
  assert.deepEqual(await exercise({ prepare: true, inspect: true, report: { verified: true } }), []);
  assert.deepEqual(await exercise({ format: true, report: { format: "CSV" } }), []);
});

test("a paired delivery creates actual CSV and PDF files, not only format labels", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-formats-"));
  try {
    const world = learningWorld(dir, {
      id: 4,
      name: "Paired formats",
      teach: [],
      queries: [{ text: "Deliver", expect: { internal_format: "csv", client_format: "pdf" } }],
    });
    world.evaluate();
    const deliver = world.tools.find((t) => t.name === "deliver_report");
    assert.ok(deliver);
    await deliver.run({ report: { internal_format: "CSV", client_format: "PDF" } }, ctx);
    const csv = world.files.find((f) => f.format === "csv");
    const pdf = world.files.find((f) => f.format === "pdf");
    assert.ok(csv);
    assert.ok(pdf);
    assert.match(fs.readFileSync(csv.path, "utf8"), /^"field","value"\n/);
    const document = fs.readFileSync(pdf.path, "utf8");
    assert.match(document, /^%PDF-1\.4\n/);
    assert.match(document, /\/Type \/Page\b/);
    assert.match(document, /%%EOF\n$/);
    assert.deepEqual(world.evaluateDelivery(0), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
