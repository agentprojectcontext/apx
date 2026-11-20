import assert from "node:assert/strict";
import { test } from "node:test";
import { closeWindowsTree } from "./windows-process-tree.ts";

const child = () => ({ pid: 42, exitCode: null, signalCode: null });

test("Windows shutdown lets a server close normally before stopping its tree", async () => {
  let stopped = false;
  const transport = { pid: 42 as number | null, async close() {} };
  closeWindowsTree(transport, {
    root: child,
    stop: async () => {
      stopped = true;
    },
    grace: () => new Promise(() => {}),
  });
  await transport.close();
  assert.equal(stopped, false);
});

test("Windows shutdown shares concurrent closes and stops a stubborn tree", async () => {
  const actions: string[] = [];
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = {
    pid: 42 as number | null,
    async close() {
      actions.push("close requested");
      await closed;
    },
  };
  closeWindowsTree(transport, {
    root: child,
    grace: async () => {},
    stop: async (pid) => {
      actions.push(`stop ${pid}`);
      release();
    },
  });
  await Promise.all([transport.close(), transport.close()]);
  assert.deepEqual(actions, ["close requested", "stop 42"]);
});

test("a failed Windows tree termination is reported and can be retried", async () => {
  let attempts = 0;
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = {
    pid: 42 as number | null,
    async close() {
      await closed;
    },
  };
  closeWindowsTree(transport, {
    root: child,
    grace: async () => {},
    stop: async () => {
      if (++attempts === 1) throw new Error("tree still running");
      release();
    },
  });
  await assert.rejects(transport.close(), /tree still running/);
  await transport.close();
  assert.equal(attempts, 2);
});

test("a root already exited is not targeted by pid", async () => {
  let stopped = false;
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = {
    pid: 42 as number | null,
    async close() {
      await closed;
    },
  };
  closeWindowsTree(transport, {
    root: () => ({ pid: 42, exitCode: 0, signalCode: null }),
    grace: async () => {},
    stop: async () => {
      stopped = true;
    },
  });
  const pending = transport.close();
  await Promise.resolve();
  release();
  await pending;
  assert.equal(stopped, false);
});
