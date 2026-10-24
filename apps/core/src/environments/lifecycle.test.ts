import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createVmLifecycle, type VmDriver } from "./lifecycle.ts";

function fixture() {
  let running = false;
  let installed = false;
  const calls: string[] = [];
  const driver: VmDriver = {
    supported: true,
    installed: () => installed,
    running: async () => running,
    prepare: async (mode, signal, progress) => {
      signal.throwIfAborted();
      progress({ step: "guest" });
      calls.push(`prepare:${mode}`);
      installed = true;
      running = true;
    },
    stop: async () => {
      calls.push("stop");
      running = false;
    },
    appearance: async (mode) => {
      calls.push(`appearance:${mode}`);
    },
  };
  return { driver, calls };
}

test("computer is inert before activation; stop releases the guest and restart preserves installation", async () => {
  const { driver, calls } = fixture();
  const vm = createVmLifecycle(driver);
  try {
    assert.equal((await vm.status()).phase, "not_installed");
    assert.deepEqual(calls, []);
    vm.start("light");
    await waitFor(async () => (await vm.status()).phase === "running");
    await vm.appearance("dark");
    assert.deepEqual(calls, ["prepare:light", "appearance:dark"]);
    vm.stop();
    assert.throws(() => vm.assertRunning(), /not ready/);
    await waitFor(async () => (await vm.status()).phase === "stopped");
    assert.equal(driver.installed(), true);
    assert.equal(await driver.running(), false);
    vm.start("dark");
    await waitFor(async () => (await vm.status()).phase === "running");
    assert.deepEqual(calls, ["prepare:light", "appearance:dark", "stop", "prepare:dark"]);
  } finally {
    await vm.close();
  }
});

test("stop aborts installation and remains exclusive until cleanup completes", async () => {
  const { driver } = fixture();
  let aborted = false;
  let release: () => void = () => {};
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  driver.prepare = (_mode, signal) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  driver.stop = async () => cleanup;
  const vm = createVmLifecycle(driver);
  try {
    vm.start("light");
    vm.stop();
    assert.equal(aborted, true);
    assert.throws(() => vm.start("dark"), /already running/);
    assert.equal((await vm.status()).phase, "stopping");
    release();
    await waitFor(async () => (await vm.status()).phase === "not_installed");
    assert.equal((await vm.status()).error, undefined);
  } finally {
    release();
    await vm.close();
  }
});

test("preparation failure cleans partial guests; failed shutdown never claims RAM was released", async () => {
  const { driver, calls } = fixture();
  driver.prepare = async () => {
    throw new Error("download failed");
  };
  const vm = createVmLifecycle(driver);
  try {
    vm.start("light");
    await waitFor(async () => (await vm.status()).phase === "error");
    assert.match((await vm.status()).error ?? "", /download failed/);
    assert.deepEqual(calls, ["stop"]);
    driver.running = async () => true;
    vm.stop();
    await waitFor(async () => /memory has not been released/.test((await vm.status()).error ?? ""));
    assert.equal((await vm.status()).phase, "error");
  } finally {
    await vm.close();
  }
});

test("unsupported platforms never call the VM driver", async () => {
  const { driver, calls } = fixture();
  driver.supported = false;
  const vm = createVmLifecycle(driver);
  assert.equal((await vm.status()).phase, "unsupported");
  assert.throws(() => vm.start("light"), /macOS Apple Silicon/);
  assert.deepEqual(calls, []);
  await vm.close();
});

test("an interrupted first setup is recoverable instead of exposing an incomplete desktop as ready", async () => {
  const { driver } = fixture();
  let prepared = false;
  driver.installed = () => true;
  driver.running = async () => true;
  driver.prepared = () => prepared;
  driver.prepare = async () => {
    prepared = true;
  };
  const vm = createVmLifecycle(driver);
  try {
    assert.equal((await vm.status()).phase, "error");
    assert.match((await vm.status()).error ?? "", /interrupted/);
    assert.throws(() => vm.assertRunning(), /not ready/);
    vm.start("light");
    await waitFor(async () => (await vm.status()).phase === "running");
    assert.equal((await vm.status()).error, undefined);
  } finally {
    await vm.close();
  }
});

test("driver status failures remain recoverable and cannot reject application bootstrap", async () => {
  const { driver } = fixture();
  driver.installed = () => true;
  driver.running = async () => {
    throw new Error("Lima unavailable");
  };
  const vm = createVmLifecycle(driver);
  try {
    assert.equal((await vm.status()).phase, "error");
    assert.match((await vm.status()).error ?? "", /Lima unavailable/);
    vm.start("light");
    driver.running = async () => true;
    await waitFor(async () => (await vm.status()).phase === "running");
  } finally {
    await vm.close();
  }
});

test("shutdown waits for an in-flight network connection then closes its resources", async () => {
  const { driver } = fixture();
  driver.installed = () => true;
  driver.running = async () => true;
  let release: () => void = () => {};
  let connected = false;
  driver.connect = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    connected = true;
  };
  driver.disconnect = async () => {
    connected = false;
  };
  const vm = createVmLifecycle(driver);
  const status = vm.status();
  await new Promise((resolve) => setImmediate(resolve));
  const closing = vm.close();
  release();
  await closing;
  await status;
  assert.equal(connected, false);
  assert.throws(() => vm.assertRunning(), /not ready/);
});

test("polling a closed controller cannot reconnect its network", async () => {
  const { driver } = fixture();
  let connections = 0;
  driver.installed = () => true;
  driver.running = async () => true;
  driver.connect = async () => {
    connections++;
  };
  const vm = createVmLifecycle(driver);
  await vm.close();
  assert.equal((await vm.status()).phase, "error");
  assert.equal(connections, 0);
});

test("a first start says it sets Linux up; a start of one already set up is a boot", async () => {
  let installed = false;
  let running = false;
  let release = () => {};
  const vm = createVmLifecycle({
    supported: true,
    installed: () => installed,
    running: async () => running,
    prepare: async () => {
      await new Promise<void>((resolve) => (release = resolve));
      installed = true;
      running = true;
    },
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
  });
  try {
    vm.start("light");
    assert.equal((await vm.status()).setup, true);
    release();
    await waitFor(async () => (await vm.status()).phase === "running");
    assert.equal((await vm.status()).setup, undefined);
    await vm.stop();
    await waitFor(async () => (await vm.status()).phase !== "stopping");
    vm.start("light");
    assert.equal((await vm.status()).setup, undefined, "already set up: only a boot");
    release();
  } finally {
    await vm.close();
  }
});
