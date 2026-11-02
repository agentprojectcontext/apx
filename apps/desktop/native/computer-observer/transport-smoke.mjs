import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const helper = process.env.OBSERVER_HELPER;
assert.ok(helper, "Set OBSERVER_HELPER to the compiled spike");

function start(timeout = 4000) {
  let resolve;
  const done = new Promise((r) => {
    resolve = r;
  });
  const child = execFile(helper, [], { timeout, maxBuffer: 131072 }, (error, stdout, stderr) => {
    resolve({ error, stdout, stderr });
  });
  child.stdin.on("error", () => {});
  return { child, done };
}

async function handshake(child, parts = ['{"op":"hello"}\n']) {
  const response = once(child.stdout, "data", { signal: AbortSignal.timeout(3000) });
  for (const part of parts) child.stdin.write(part);
  const [data] = await response;
  assert.deepEqual(JSON.parse(data.toString()), { version: 1, ready: true });
}

test("real Node execFile socketpair handshake, invalid request, EOF and reaped exit", async () => {
  const { child, done } = start();
  await handshake(child);
  child.stdin.end('{"op":"not-an-observation"}\n');
  const result = await done;
  assert.equal(result.error, null);
  assert.equal(result.stderr, "");
  const frames = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(frames.length, 2);
  assert.equal(frames[1].error, "INVALID_REQUEST");
  assert.equal(frames[1].observation, undefined);
  assert.equal(child.exitCode, 0);
});

test("correlated requests echo distinct IDs without bypassing request refusal", async () => {
  const { child, done } = start();
  await handshake(child);
  const ids = ["12345678-1234-4234-8234-123456789abc", "12345678-1234-4234-8234-123456789abd"];
  child.stdin.end(
    `${ids.map((requestID) => JSON.stringify({ requestID, command: { op: "not-an-observation" } })).join("\n")}\n`,
  );
  const result = await done;
  assert.equal(result.error, null);
  assert.equal(result.stderr, "");
  const frames = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.requestID),
    ids,
  );
  for (const frame of frames.slice(1)) {
    assert.deepEqual(Object.keys(frame).sort(), ["requestID", "result"]);
    assert.equal(frame.result.error, "INVALID_REQUEST");
    assert.equal(frame.result.listing, undefined);
    assert.equal(frame.result.selectedObservation, undefined);
  }
  assert.notEqual(frames[1].result.generation, frames[2].result.generation);
});

test("invalid correlated envelope is refused without echoing caller text", async () => {
  const { child, done } = start();
  await handshake(child);
  child.stdin.end(`${JSON.stringify({ requestID: "PRIVATE_MARKER", command: { op: "listWindows" } })}\n`);
  const result = await done;
  assert.equal(result.error, null);
  assert.equal(result.stderr, "");
  const frames = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(frames.length, 2);
  assert.equal(frames[1].error, "INVALID_REQUEST");
  assert.equal(frames[1].requestID, undefined);
  assert.equal(result.stdout.includes("PRIVATE_MARKER"), false);
});

test("fragmented hello and multiple bounded frames", async () => {
  const { child, done } = start();
  await handshake(child, ['{"op":', '"hello"}', "\n"]);
  child.stdin.end('bad\n{"op":"press"}\n');
  const result = await done;
  assert.equal(result.error, null);
  const frames = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.error),
    ["INVALID_REQUEST", "INVALID_REQUEST"],
  );
});

test("invalid initial frame fails nonzero without output", async () => {
  const { child, done } = start();
  child.stdin.write('{"op":"listWindows","pid":1}\n');
  const result = await done;
  assert.ok(result.error);
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("oversized hello fails without observation", async () => {
  const { child, done } = start();
  child.stdin.write(`${"x".repeat(8193)}\n`);
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("oversized hello without newline fails before the input deadline", async () => {
  const { child, done } = start();
  child.stdin.write("x".repeat(8193));
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("hello followed by a partial command is rejected before acknowledgement", async () => {
  const { child, done } = start();
  child.stdin.write('{"op":"hello"}\n{');
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("closed Node output after acknowledgement fails without a signal crash", async () => {
  const { child, done } = start();
  await handshake(child);
  child.stdout.destroy();
  child.stdin.write("bad\n");
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(child.signalCode, null);
  assert.ok(result.error);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, ready: true });
  assert.equal(result.stderr, "");
});

test("EOF before hello fails without output", async () => {
  const { child, done } = start();
  child.stdin.end();
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("EOF immediately after hello exits cleanly without observation", async () => {
  const { child, done } = start();
  await handshake(child);
  child.stdin.end();
  const result = await done;
  assert.equal(result.error, null);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, ready: true });
});

test("oversized and unterminated observation frames remain bounded", async () => {
  const { child, done } = start();
  await handshake(child);
  child.stdin.end(`${"x".repeat(8193)}\npartial`);
  const result = await done;
  assert.equal(result.error, null);
  const frames = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.error),
    ["INVALID_REQUEST", "INVALID_REQUEST"],
  );
  assert.ok(Buffer.byteLength(result.stdout) < 1024);
});

test("hello and buffered command are rejected before acknowledgement", async () => {
  const { child, done } = start();
  child.stdin.write('{"op":"hello"}\nbad\n');
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("hello plus command plus write-half close never produces a command response", async () => {
  const { child, done } = start();
  child.stdin.end('{"op":"hello"}\nbad\n');
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("partial hello followed by EOF fails without acknowledgement", async () => {
  const { child, done } = start();
  child.stdin.end('{"op":"hel');
  const result = await done;
  assert.equal(child.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("parent deadline kills and waits for an idle post-handshake helper", async () => {
  const { child, done } = start();
  await handshake(child);
  // portable: Real child watchdog integration; no helper idle-time policy is inferred.
  const result = await done;
  assert.ok(result.error);
  assert.equal(result.error.killed, true);
  assert.equal(child.signalCode, "SIGTERM");
  assert.equal(child.exitCode, null);
  assert.equal(result.stderr, "");
});

test("parent termination is observed and process reaped", async () => {
  const { child, done } = start();
  await handshake(child);
  assert.equal(child.kill("SIGTERM"), true);
  const result = await done;
  assert.equal(child.signalCode, "SIGTERM");
  assert.ok(result.error);
  assert.equal(result.stderr, "");
});
