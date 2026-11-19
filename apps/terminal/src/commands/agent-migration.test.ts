import assert from "node:assert/strict";
import { test } from "node:test";
import { agentMove } from "./agent-migration.ts";
import { printed, recordingClient } from "./testing.ts";

const id = "2bd15883-b63d-4e7c-9fd0-d80fb5736f0e";
test("moving previews by default and preserves explicitly selected paths", async () => {
  const preview = { id, revision: "revision", blockers: ["active_run"], tasks: ["task_acme"] };
  const { client, calls } = recordingClient({ "agents.migration_preview": preview });
  const out = await printed(() => agentMove(client, ["acme", "p_northwind", "reports/selected"]));
  assert.deepEqual(JSON.parse(out), preview);
  assert.deepEqual(calls, [
    ["agents.migration_preview", { agent: "acme", destination: "p_northwind", paths: ["reports/selected"] }],
  ]);
});

test("apply requires a reviewed id and revision and never silently refreshes the preview", async () => {
  const { client, calls } = recordingClient({ "agents.migrate": { id, state: "committed" } });
  for (const options of [{ apply: true }, { apply: true, id }, { id, revision: "r" }])
    await assert.rejects(agentMove(client, ["acme", "p_northwind"], options), /usage:/);
  assert.equal(calls.length, 0);
  await printed(() => agentMove(client, ["acme", "p_northwind", "report.csv"], { apply: true, id, revision: "r" }));
  assert.deepEqual(calls, [
    ["agents.migrate", { agent: "acme", destination: "p_northwind", paths: ["report.csv"], id, revision: "r" }],
  ]);
});

test("recover is an explicit distinct operation and invalid ids never reach the core", async () => {
  const { client, calls } = recordingClient({ "agents.migration_recover": { id, restored: true } });
  await assert.rejects(agentMove(client, ["recover", "invalid"]));
  await assert.rejects(agentMove(client, ["recover", id, "extra"]), /usage:/);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(await printed(() => agentMove(client, ["recover", id]))), { id, restored: true });
  assert.deepEqual(calls, [["agents.migration_recover", { id }]]);
});

test("a stale or blocked apply error propagates without a second attempt", async () => {
  const { client, calls } = recordingClient({ "agents.migrate": new Error("preview changed") });
  await assert.rejects(
    agentMove(client, ["acme", "p_northwind"], { apply: true, id, revision: "stale" }),
    /preview changed/,
  );
  assert.equal(calls.length, 1);
});
