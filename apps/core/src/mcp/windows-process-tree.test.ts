import assert from "node:assert/strict";
import { test } from "node:test";
import { closeWindowsTree } from "./windows-process-tree.ts";

test("Windows shutdown waits for the process tree and shares concurrent closes", async () => {
  const actions: string[] = [];
  let release!: () => void;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = {
    pid: 42 as number | null,
    async close() {
      actions.push("transport closed");
    },
  };
  closeWindowsTree(transport, async (pid) => {
    actions.push(`stop ${pid}`);
    await stopped;
  });
  const first = transport.close();
  const second = transport.close();
  assert.deepEqual(actions, ["stop 42"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(actions, ["stop 42", "transport closed"]);
});

test("a failed Windows tree termination is reported and can be retried", async () => {
  let attempts = 0;
  let closed = false;
  const transport = {
    pid: 42 as number | null,
    async close() {
      closed = true;
    },
  };
  closeWindowsTree(transport, async () => {
    if (++attempts === 1) throw new Error("tree still running");
  });
  await assert.rejects(transport.close(), /tree still running/);
  assert.equal(closed, false);
  await transport.close();
  assert.equal(attempts, 2);
  assert.equal(closed, true);
});
