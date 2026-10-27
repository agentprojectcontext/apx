import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApxClient } from "@apx/protocol/client";
import { flows } from "./flows.ts";

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
});
