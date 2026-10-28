import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApxClient } from "@apx/protocol/client";
import { flows } from "./flows.ts";

test("export follows every row and event cursor and refuses a live Flow", async (t) => {
  const output: string[] = [];
  t.mock.method(console, "log", (text: string) => output.push(text));
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let enabled = true;
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "flows.list") return { flows: [{ id: "f", enabled }] };
      if (method === "flows.rows") {
        const start = params.cursor === undefined ? 0 : Number(params.cursor) + 1;
        const rows = Array.from({ length: Math.min(100, 205 - start) }, (_, i) => ({
          key: String(start + i),
          value: start + i,
        }));
        return { rows, nextCursor: start + rows.length < 205 ? rows.at(-1)?.key : null };
      }
      if (method === "flows.events") {
        const cursor = params.cursor as { eventId: string } | undefined;
        const start = cursor === undefined ? 0 : Number(cursor.eventId) + 1;
        const events = Array.from({ length: Math.min(100, 205 - start) }, (_, i) => ({
          event_id: String(start + i),
          executor: start + i === 7 ? "graph" : "legacy",
        }));
        return {
          events,
          nextCursor:
            start + events.length < 205
              ? { createdAt: "2026-01-01T00:00:00.000Z", eventId: events.at(-1)?.event_id }
              : null,
        };
      }
      if (method === "flows.graph_get") return { flow: "f", draft: null, publishedRevision: 1 };
      if (method === "flows.run_get") return { event: params.event, steps: [] };
      throw new Error(`Unexpected method: ${method}`);
    },
  } as unknown as ApxClient;
  await assert.rejects(flows(client, ["export", "f"], "p"), /disabled/);
  assert.equal(calls.length, 1, "no partial export from an enabled Flow");
  enabled = false;
  await flows(client, ["export", "f"], "p");
  const saved = JSON.parse(output[0] ?? "null") as {
    rows: Array<{ key: string }>;
    events: Array<{ event_id: string }>;
    graph: { publishedRevision: number };
    runs: unknown[];
  };
  assert.equal(saved.rows.length, 205);
  assert.equal(saved.rows.at(-1)?.key, "204");
  assert.equal(saved.events.length, 205);
  assert.equal(saved.events.at(-1)?.event_id, "204");
  assert.equal(saved.graph.publishedRevision, 1);
  assert.deepEqual(saved.runs, [{ event: "7", steps: [] }]);
  assert.equal(calls.filter((c) => c.method === "flows.rows").length, 3);
  assert.equal(calls.filter((c) => c.method === "flows.events").length, 3);
  assert.ok(
    calls.every((c) => c.method !== "flows.retire"),
    "export is read-only",
  );
});

test("Flow commands call the canonical protocol and reject malformed input before effects", async () => {
  const calls: unknown[] = [];
  const client = {
    async call(method: string, params: unknown) {
      calls.push([method, params]);
      return {};
    },
  } as unknown as ApxClient;
  await flows(client, ["list"], "p");
  await flows(client, ["rows", "f"]);
  await flows(client, ["events", "f"]);
  await flows(client, ["write", "f", "counter", "3"]);
  await flows(client, ["retry", "f", "event"]);
  assert.deepEqual(calls, [
    ["flows.list", { project: "p" }],
    ["flows.rows", { flow: "f" }],
    ["flows.events", { flow: "f" }],
    ["flows.write", { flow: "f", key: "counter", value: 3 }],
    ["flows.retry", { flow: "f", event: "event" }],
  ]);
  await assert.rejects(flows(client, ["set", "invalid"]), SyntaxError);
  await assert.rejects(flows(client, ["list"]), /usage/);
  await assert.rejects(flows(client, ["write", "f"]), /usage/);
  assert.equal(calls.length, 5);
  await assert.rejects(flows(client, ["retire", "f"]), /permanently/);
  await assert.rejects(flows(client, ["retire", "f", "confirm"]), /export/);
  await flows(client, ["retire", "f", "confirm-exported"]);
  assert.deepEqual(calls.at(-1), ["flows.retire", { flow: "f", confirm: true, exported: true }]);
});
