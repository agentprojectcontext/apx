import assert from "node:assert/strict";
import { test } from "node:test";
import { memory } from "./memory.ts";
import { printed, recordingClient } from "./testing.ts";

test("memory edit rewrites a note in place by its id", async () => {
  const { client, calls } = recordingClient({
    "memory.add": { id: "mem_1", scope: "project", project_id: "p_acme", text: "Acme pays on Fridays" },
  });
  assert.match(
    await printed(() => memory(client, ["edit", "mem_1", "Acme", "pays", "on", "Fridays"], {})),
    /mem_1 {2}project:p_acme {2}edited/,
  );
  assert.deepEqual(calls, [["memory.add", { id: "mem_1", text: "Acme pays on Fridays", scope: "global" }]]);
  await assert.rejects(memory(client, ["edit", "mem_1"], {}), /usage: apx memory edit/);
});
