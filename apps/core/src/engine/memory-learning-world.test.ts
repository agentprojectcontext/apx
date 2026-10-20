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
  route?: "correct" | "wrong" | "missing";
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-world-"));
  try {
    const world = learningWorld(dir, {
      id: 1,
      name: "Delivery",
      teach: [],
      requireRoute: !!o.route,
      ...(o.format ? {} : { asset: o.missing ? "missing" : "normal" }),
      queries: [{ text: "Deliver", expect: o.format ? { format: "csv" } : { verified: "true" } }],
    });
    const run = async (name: string, args: Record<string, unknown>) => {
      const t = world.tools.find((t) => t.name === name);
      assert.ok(t);
      return t.run(args, ctx);
    };
    world.evaluate();
    let route: string | undefined;
    if (o.prepare) {
      const { routes } = JSON.parse(await run("inspect_routes", {}));
      route = routes[0];
      await run("prepare_asset", { route });
    }
    if (o.inspect && !o.inspectAfterDelivery) await run("inspect_asset", {});
    await run("deliver_report", {
      report: {
        ...o.report,
        ...(o.route === "correct" ? { route } : o.route === "wrong" ? { route: "invented" } : {}),
      },
    });
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

for (const drift of ["none", "rediscover", "failed-path", "parent-produces", "parent-inspects"] as const)
  test(`delegated method scoring checks the recipient's first attempt: ${drift}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-handoff-"));
    const producer = { agent: { slug: "producer" } } as ToolContext;
    try {
      const world = learningWorld(dir, {
        id: 18,
        name: "Method handoff",
        teach: [],
        asset: "normal",
        reuseMethod: true,
        delegate: true,
        queries: [{ text: "Repeat", expect: { verified: "true" } }],
      });
      const run = async (name: string, args: Record<string, unknown>, actor = ctx) => {
        const tool = world.tools.find((t) => t.name === name);
        assert.ok(tool);
        return tool.run(args, actor);
      };
      const { routes } = JSON.parse(await run("inspect_routes", {}));
      const route = routes[0];
      await run("prepare_asset", { route });
      await run("inspect_asset", {});
      world.evaluate();
      await run("inspect_routes", { route });
      if (drift === "failed-path") await assert.rejects(() => run("fetch_asset", {}), /Direct download unavailable/);
      if (drift === "parent-produces") {
        await run("prepare_asset", { route });
        await run("inspect_asset", {});
      }
      await run("inspect_routes", drift === "rediscover" ? {} : { route }, producer);
      if (drift !== "parent-produces") {
        await run("prepare_asset", { route }, producer);
        await run("inspect_asset", {}, drift === "parent-inspects" ? ctx : producer);
      }
      await run("deliver_report", { report: { verified: true, route } }, producer);
      const failures = world.evaluateDelivery(0);
      if (drift === "none") assert.deepEqual(failures, []);
      else
        assert.match(
          failures.join("\n"),
          drift === "rediscover"
            ? /reuse the confirmed method/
            : drift === "failed-path"
              ? /known failed/
              : /claimed success|never inspected/,
        );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

for (const route of ["correct", "wrong", "missing"] as const)
  test(`learning reports must name the actual route when requested: ${route}`, async () => {
    const failures = await exercise({ prepare: true, inspect: true, report: { verified: true }, route });
    if (route === "correct") assert.deepEqual(failures, []);
    else assert.match(failures.join("\n"), /reported route/);
  });

test("the artifact tool accepts the standard Markdown extension alias", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-markdown-"));
  try {
    const world = learningWorld(dir, {
      id: 19,
      name: "Markdown",
      teach: [],
      queries: [{ text: "Deliver Markdown", expect: { format: "markdown|md" } }],
    });
    const deliver = world.tools.find((t) => t.name === "deliver_report");
    assert.ok(deliver);
    world.evaluate();
    await deliver.run({ report: { format: "md", heading: "Decision" } }, ctx);
    assert.deepEqual(world.evaluateDelivery(0), []);
    assert.equal(world.files[0]?.format, "markdown");
    assert.match(fs.readFileSync(world.files[0]?.path ?? "", "utf8"), /^# Decision\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
