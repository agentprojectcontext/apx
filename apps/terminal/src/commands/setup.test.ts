import assert from "node:assert/strict";
import { test } from "node:test";
import { importV1, setupHeadless } from "./setup.ts";
import { printed, recordingClient } from "./testing.ts";
import { v1 } from "./v1.ts";

test("v1 import requires explicit consent for keys, skills and services while importing nonempty ordinary groups", async () => {
  for (const consent of [false, true]) {
    const { client, calls } = recordingClient({
      "setup.v1_scan": {
        groups: [
          { id: "projects", count: 2 },
          { id: "agents", count: 0 },
          { id: "keys", count: 1 },
          { id: "skills", count: 3 },
          { id: "services", count: 1 },
        ],
      },
      "setup.import_v1": { imported: { projects: 2, agents: 0 }, errors: [] },
    });
    const output = await printed(() => importV1(client, { keys: consent, skills: consent, services: consent }));
    assert.deepEqual(calls, [
      ["setup.v1_scan", {}],
      ["setup.import_v1", { groups: consent ? ["projects", "keys", "skills", "services"] : ["projects"] }],
    ]);
    assert.equal(output, "imported from v1: 2 projects");
  }
});

test("v1 import avoids an empty effect and reports partial import failures", async (t) => {
  const empty = recordingClient({ "setup.v1_scan": { groups: [{ id: "keys", count: 1 }] } });
  assert.equal(
    await printed(() => importV1(empty.client, { keys: false, skills: false, services: false })),
    "APX v1 has nothing to import here",
  );
  assert.deepEqual(empty.calls, [["setup.v1_scan", {}]]);
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  const partial = recordingClient({
    "setup.v1_scan": { groups: [{ id: "projects", count: 1 }] },
    "setup.import_v1": { imported: {}, errors: ["Project folder unavailable"] },
  });
  assert.equal(
    await printed(() => importV1(partial.client, { keys: false, skills: false, services: false })),
    "imported from v1: nothing new",
  );
  assert.deepEqual(errors, [["  Project folder unavailable"]]);
});

test("headless setup rejects invalid intent before installing a system service", async () => {
  const { client, calls } = recordingClient({});
  await assert.rejects(
    setupHeadless(() => client, {}),
    /setup --headless/,
  );
  await assert.rejects(
    setupHeadless(() => client, { headless: true, expose: "public" }),
    /tailscale or lan/,
  );
  assert.deepEqual(calls, []);
});

test("v1 status distinguishes absent, stopped and running installations", async () => {
  for (const v1_running of [false, true]) {
    const { client, calls } = recordingClient({
      "setup.status": { v1: { version: "1.0", home: "/work/v1", projects: 2 }, v1_running },
    });
    const output = await printed(() => v1(client, []));
    assert.match(output, /APX v1 1.0 in \/work\/v1 · 2 projects/);
    assert.ok(output.includes(v1_running ? "routines and bots may run twice" : "its daemon is off"));
    assert.deepEqual(calls, [["setup.status", {}]]);
  }
  const absent = recordingClient({ "setup.status": {} });
  assert.equal(await printed(() => v1(absent.client, [])), "APX v1 is not on this machine.");
  await assert.rejects(v1(absent.client, ["unknown"]), /usage: apx v1/);
});

test("v1 takeover reports failure as a failing command and preserves the core's explanation", async () => {
  const previous = process.exitCode;
  try {
    for (const ok of [true, false]) {
      process.exitCode = 0;
      const { client, calls } = recordingClient({
        "setup.take_over_cli": { ok, detail: "Service stopped. CLI moved" },
      });
      const output = await printed(() => v1(client, ["off"]));
      assert.equal(output, `${ok ? "✓" : "⚠"} Service stopped\n  CLI moved`);
      assert.equal(process.exitCode, ok ? 0 : 1);
      assert.deepEqual(calls, [["setup.take_over_cli", {}]]);
    }
  } finally {
    process.exitCode = previous;
  }
});
