import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { Execution, Executor, Snapshot, Target } from "./bridge.ts";
import { AccessibilityLabBridge, BridgeError, LIMITS } from "./bridge.ts";

function reply(command: string, data: unknown, overrides: Record<string, unknown> = {}): Execution {
  return { stdout: JSON.stringify({ version: "2.5", ok: true, command, data, ...overrides }), stderr: "", exitCode: 0 };
}
function snapshotData(overrides: Record<string, unknown> = {}) {
  return {
    app: "Acme",
    window: { id: "42" },
    snapshot_id: "s1",
    complete: true,
    ref_count: 1,
    tree: {
      ref_id: "@s1:e1",
      role: "textfield",
      name: "Public text",
      states: [],
      available_actions: ["Click", "TypeText"],
    },
    ...overrides,
  };
}
function harness(authorize = true) {
  const calls: { binary: string; args: readonly string[]; options: Parameters<Executor>[2] }[] = [];
  const outputs: (Execution | Error | (() => Promise<Execution>))[] = [];
  const execute: Executor = async (binary, args, options) => {
    calls.push({ binary, args, options });
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    if (typeof output === "function") return output();
    assert.ok(output, `Unexpected command: ${args.join(" ")}`);
    return output;
  };
  const config = {
    binary: resolve("synthetic-bin"),
    home: resolve("synthetic-home"),
    namespace: "lab_one",
    expectedVersion: "1.0.2",
    execute,
    authorize: () => authorize,
  };
  const bridge = new AccessibilityLabBridge(config);
  const observe = (data: Record<string, unknown> = snapshotData()) => {
    outputs.push(reply("version", { version: "1.0.2" }), reply("snapshot", data));
    return bridge.snapshot({ app: "Acme", window: "42" });
  };
  return { calls, outputs, bridge, observe, config };
}
function target(snapshot: Snapshot): Target {
  assert.ok(snapshot.tree.ref);
  return { snapshot: snapshot.id, app: snapshot.app, window: snapshot.window, ref: snapshot.tree.ref };
}
function code(expected: string) {
  return (error: unknown) => error instanceof BridgeError && error.code === expected;
}

test("exact allowlisted command, version gate, private environment and immutable result", async () => {
  const h = harness();
  const s = await h.observe();
  assert.deepEqual(
    h.calls.map((call) => call.args),
    [
      ["--session", "lab_one", "version"],
      [
        "--session",
        "lab_one",
        "snapshot",
        "--timeout-ms",
        "3000",
        "--max-depth",
        "16",
        "--app",
        "Acme",
        "--window-id",
        "42",
      ],
    ],
  );
  assert.equal(h.calls[0]?.binary, h.config.binary);
  assert.deepEqual(h.calls[0]?.options, {
    env: { HOME: h.config.home },
    timeout: 4000,
    maxBuffer: 131072,
    shell: false,
  });
  assert.ok(Object.isFrozen(s.tree.states));
  assert.ok(Object.isFrozen(s));
  assert.notEqual(s.tree.ref, "@s1:e1");
});

test("namespace/config copied and shell-shaped app stays one argument", async () => {
  const h = harness();
  h.config.namespace = "changed";
  h.outputs.push(reply("version", { version: "1.0.2" }), reply("snapshot", snapshotData({ app: "Acme; echo unsafe" })));
  const s = await h.bridge.snapshot({ app: "Acme; echo unsafe" });
  assert.equal(s.app, "Acme; echo unsafe");
  assert.deepEqual(h.calls[1]?.args.slice(-2), ["--app", "Acme; echo unsafe"]);
  assert.equal(h.calls[1]?.args[1], "lab_one");
});

test("option-shaped selectors cannot enable global native flags", async () => {
  const h = harness();
  await assert.rejects(h.bridge.snapshot({ app: "--headed" }), code("INVALID_SELECTOR"));
  await assert.rejects(h.bridge.snapshot({ window: "--trace" }), code("INVALID_SELECTOR"));
  assert.equal(h.calls.length, 0);
});

test("rejects invalid trusted config before execution", () => {
  const h = harness();
  assert.throws(() => new AccessibilityLabBridge({ ...h.config, binary: "relative" }), code("INVALID_CONFIG"));
  assert.throws(
    () => new AccessibilityLabBridge({ ...h.config, namespace: "--headed" + "\n" }),
    code("INVALID_CONFIG"),
  );
  assert.equal(h.calls.length, 0);
});

test("root is mapped only from own refs; new generation retires old refs", async () => {
  const h = harness();
  const first = await h.observe();
  h.outputs.push(reply("snapshot", snapshotData()));
  const second = await h.bridge.snapshot({ root: target(first), skeleton: true });
  assert.deepEqual(h.calls[2]?.args.slice(-3), ["--skeleton", "--root", "@s1:e1"]);
  assert.notEqual(second.id, first.id);
  await assert.rejects(h.bridge.click(target(first)), code("STALE_OR_FOREIGN_REF"));
  await assert.rejects(h.bridge.snapshot({ root: target(first) }), code("STALE_OR_FOREIGN_REF"));
  assert.equal(h.calls.length, 3);
});

test("unknown refs, different bridge, app/window/snapshot mismatch spawn nothing", async () => {
  const h = harness();
  const s = await h.observe();
  for (const wrong of [
    { ...target(s), app: "Northwind" },
    { ...target(s), window: "43" },
  ]) {
    await assert.rejects(h.bridge.click(wrong), code("TARGET_MISMATCH"));
  }
  for (const wrong of [
    { ...target(s), ref: "@s1:e1" },
    { ...target(s), snapshot: "old" },
  ]) {
    await assert.rejects(h.bridge.type(wrong, "public"), code("STALE_OR_FOREIGN_REF"));
  }
  await assert.rejects(harness().bridge.click(target(s)), code("STALE_OR_FOREIGN_REF"));
  assert.equal(h.calls.length, 2);
});

for (const [label, tree, expected] of [
  [
    "secure state even with advertised text/value actions",
    { states: ["secure"], available_actions: ["Click", "TypeText", "SetValue"] },
    "SECURE_TARGET",
  ],
  ["secure role", { role: "AXSecureTextField" }, "SECURE_TARGET"],
  ["disabled", { states: ["disabled"] }, "UNAVAILABLE_TARGET"],
  ["hidden", { states: ["hidden"] }, "UNAVAILABLE_TARGET"],
  ["unsupported", { available_actions: [] }, "UNAVAILABLE_ACTION"],
] as const) {
  test(`${label} rejected before any preflight or mutation spawn`, async () => {
    const h = harness();
    const data = snapshotData();
    const s = await h.observe({ ...data, tree: { ...data.tree, ...tree } });
    await assert.rejects(h.bridge.click(target(s)), code(expected));
    await assert.rejects(h.bridge.type(target(s), "public"), code(expected));
    assert.equal(h.calls.length, 2);
  });
}

test("unapproved actions do not spawn", async () => {
  const h = harness(false);
  const s = await h.observe();
  await assert.rejects(h.bridge.click(target(s)), code("NOT_APPROVED"));
  await assert.rejects(h.bridge.type(target(s), "public"), code("NOT_APPROVED"));
  assert.equal(h.calls.length, 2);
});

test("preflight secure transition blocks; benign cached states cannot authorize mutation", async () => {
  const h = harness();
  const s = await h.observe();
  h.outputs.push(reply("get", { property: "states", ref: "@s1:e1", value: ["secure"] }));
  await assert.rejects(h.bridge.type(target(s), "never delivered"), code("SECURE_TARGET"));
  h.outputs.push(reply("get", { property: "states", ref: "@s1:e1", value: [] }));
  await assert.rejects(h.bridge.click(target(s)), code("ATOMIC_NATIVE_GUARD_REQUIRED"));
  assert.deepEqual(
    h.calls.slice(2).map((call) => call.args),
    [
      ["--session", "lab_one", "get", "@s1:e1", "--property", "states"],
      ["--session", "lab_one", "get", "@s1:e1", "--property", "states"],
    ],
  );
});

test("bounded error disposition passes through; no retries or automatic fallback", async () => {
  const h = harness();
  const s = await h.observe();
  h.outputs.push(
    reply("get", undefined, {
      ok: false,
      error: {
        code: "STALE_REF",
        message: "Untrusted detail omitted",
        disposition: { delivery: "unknown", retry: "never" },
      },
    }),
  );
  await assert.rejects(h.bridge.click(target(s)), (error: unknown) => {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, "STALE_REF");
    assert.deepEqual(error.disposition, { delivery: "unknown", retry: "never" });
    assert.equal(error.message, "STALE_REF");
    return true;
  });
  assert.equal(h.calls.length, 3);
  assert.equal(h.outputs.length, 0);
});

test("transport timeout/uncertain read does not replay or expose transport details", async () => {
  const h = harness();
  const s = await h.observe();
  h.outputs.push(new Error("private process detail"));
  await assert.rejects(h.bridge.click(target(s)), code("TRANSPORT_UNCERTAIN"));
  assert.equal(h.calls.length, 3);
});

for (const [label, response, expected] of [
  ["malformed", { stdout: "{", stderr: "", exitCode: 0 }, "INVALID_OUTPUT"],
  ["oversized", { stdout: "x".repeat(LIMITS.bytes + 1), stderr: "", exitCode: 0 }, "INVALID_OUTPUT"],
  ["binary", { stdout: "\u0000", stderr: "", exitCode: 0 }, "INVALID_OUTPUT"],
  ["protocol", reply("snapshot", snapshotData(), { version: "2.4" }), "PROTOCOL_MISMATCH"],
  ["wrong command", reply("click", snapshotData()), "PROTOCOL_MISMATCH"],
  ["nonzero success", { ...reply("snapshot", snapshotData()), exitCode: 1 }, "INVALID_OUTPUT"],
  ["stderr", { ...reply("snapshot", snapshotData()), stderr: "warning" }, "INVALID_OUTPUT"],
  ["truncated", reply("snapshot", snapshotData({ complete: false })), "INCOMPLETE_SNAPSHOT"],
  ["foreign native ref", reply("snapshot", snapshotData({ snapshot_id: "other" })), "INVALID_OUTPUT"],
  ["wrong app", reply("snapshot", snapshotData({ app: "Northwind" })), "TARGET_MISMATCH"],
  ["wrong window", reply("snapshot", snapshotData({ window: { id: "43" } })), "TARGET_MISMATCH"],
  [
    "missing states type",
    reply("snapshot", snapshotData({ tree: { role: "button", states: "secure" } })),
    "INVALID_OUTPUT",
  ],
] as const) {
  test(`${label} output fails closed and retires old refs`, async () => {
    const h = harness();
    const s = await h.observe();
    h.outputs.push(response);
    await assert.rejects(h.bridge.snapshot({ app: "Acme", window: "42" }), code(expected));
    await assert.rejects(h.bridge.click(target(s)), code("STALE_OR_FOREIGN_REF"));
    assert.equal(h.calls.length, 3);
  });
}

test("version mismatch blocks snapshot spawn", async () => {
  const h = harness();
  h.outputs.push(reply("version", { version: "1.0.3" }));
  await assert.rejects(h.bridge.snapshot(), code("VERSION_MISMATCH"));
  assert.equal(h.calls.length, 1);
});

test("concurrent operations rejected instead of queued or replayed", async () => {
  const h = harness();
  let finish: ((value: Execution) => void) | undefined;
  h.outputs.push(
    () =>
      new Promise<Execution>((resolve) => {
        finish = resolve;
      }),
    reply("snapshot", snapshotData()),
  );
  const pending = h.bridge.snapshot();
  await assert.rejects(h.bridge.snapshot(), code("BUSY"));
  assert.ok(finish);
  finish(reply("version", { version: "1.0.2" }));
  const s = await pending;
  assert.equal(s.app, "Acme");
  assert.equal(h.calls.length, 2);
});

test("invalid text never reaches executor", async () => {
  const h = harness();
  const s = await h.observe();
  await assert.rejects(h.bridge.type(target(s), "x".repeat(4097)), code("INVALID_TEXT"));
  await assert.rejects(h.bridge.type(target(s), "public\ntext"), code("INVALID_TEXT"));
  assert.equal(h.calls.length, 2);
});
