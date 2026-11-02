import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import documents from "./electron-documents.cjs";
import { validateNavigationResult, validateReadAudit } from "./lab-results.mjs";

for (const key of ["OBSERVER_LAB_PROBE", "OBSERVER_ELECTRON", "OBSERVER_IDENTITY_PROBE", "OBSERVER_FIXTURE_DATA"]) {
  assert.ok(process.env[key], `Set ${key} to an isolated lab path`);
}
const summary = { forcedRendererAccessibility: true, cases: [] };
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Acme remote</title><button>SYNTHETIC_REMOTE_SENTINEL</button>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const remoteURL = `http://127.0.0.1:${server.address().port}/fixture`;

function probe(authority, request = authority) {
  return JSON.parse(
    execFileSync(process.env.OBSERVER_LAB_PROBE, [], {
      input: JSON.stringify(request),
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8192,
      env: { ...process.env, OBSERVER_LAB_AUTHORITY: JSON.stringify(authority), OBSERVER_LAB_PAUSE_ROOT: "0" },
      stdio: ["pipe", "pipe", "ignore"],
    }),
  );
}

async function navigationProbe(authority, fixture, lines) {
  const child = spawn(process.env.OBSERVER_LAB_PROBE, [], {
    env: { ...process.env, OBSERVER_LAB_AUTHORITY: JSON.stringify(authority), OBSERVER_LAB_PAUSE_ROOT: "1" },
    stdio: ["pipe", "pipe", "ignore", "pipe", "pipe"],
  });
  let output = "";
  let overflow = false;
  child.stdout.on("data", (data) => {
    if (Buffer.byteLength(output) + data.length > 8192) {
      overflow = true;
      child.kill("SIGKILL");
    } else output += data.toString("utf8");
  });
  child.stdin.on("error", () => {});
  child.stdio[3].on("error", () => {});
  let spawnError;
  const closed = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error.code ?? "SPAWN_FAILED";
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  const event = new AbortController();
  const eventTimer = setTimeout(() => event.abort(), 3500);
  try {
    const paused = once(child.stdio[4], "data", { signal: event.signal });
    child.stdin.end(JSON.stringify(authority));
    const [signal] = await paused;
    assert.deepEqual(signal, Buffer.from([1]), "INVALID_NAVIGATION_PAUSE");
    const navigated = once(lines, "line", { signal: event.signal });
    fixture.stdin.write("navigate\n");
    const [line] = await navigated;
    assert.equal(line, "FIXTURE_NAVIGATED", "NAVIGATION_NOT_CONFIRMED");
    child.stdio[3].end(Buffer.from([1]));
    const status = await closed;
    assert.equal(spawnError, undefined, "NAVIGATION_PROBE_SPAWN_FAILED");
    assert.equal(status.code, 0, "NAVIGATION_PROBE_FAILED");
    assert.equal(overflow, false, "NAVIGATION_PROBE_OVERSIZED");
    return JSON.parse(output);
  } finally {
    event.abort();
    clearTimeout(eventTimer);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
}

async function runCase(mode) {
  const child = spawn(
    process.env.OBSERVER_ELECTRON,
    ["--force-renderer-accessibility", fileURLToPath(new URL("electron-fixture.cjs", import.meta.url))],
    {
      env: {
        ...process.env,
        OBSERVER_FIXTURE_DATA: join(process.env.OBSERVER_FIXTURE_DATA, mode),
        OBSERVER_FIXTURE_MODE: mode,
        OBSERVER_FIXTURE_REMOTE_URL: remoteURL,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stderr.resume();
  child.stdin.on("error", () => {});
  const lines = createInterface({ input: child.stdout });
  let readyTimer;
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(Error("FIXTURE_EARLY_EXIT")));
      lines.once("line", (line) => (line === "FIXTURE_READY" ? resolve() : reject(Error("INVALID_FIXTURE_READY"))));
      readyTimer = setTimeout(() => reject(Error("FIXTURE_DEADLINE")), 10000);
    });
    clearTimeout(readyTimer);
    const target = JSON.parse(
      execFileSync(process.env.OBSERVER_IDENTITY_PROBE, [String(child.pid)], { encoding: "utf8", timeout: 3000 }),
    );
    const nested = mode === "nested-iframe";
    const authority = {
      ...target,
      urls: [documents.fixtureURL("alpha", nested), documents.fixtureURL("beta", nested)],
    };
    const started = performance.now();
    const result = mode === "navigate" ? await navigationProbe(authority, child, lines) : probe(authority);
    const report = { mode, ms: Math.round(performance.now() - started), ...result };
    summary.cases.push(report);
    validateReadAudit(result, mode);
    if (mode === "local") {
      assert.equal(result.error, undefined, "LOCAL_RENDERER_REFUSED");
      assert.equal(result.observations.length, 2);
      assert.ok(result.observations.every((item) => item.sentinelsAbsent && item.alpha !== item.beta));
      assert.equal(result.observations.filter((item) => item.alpha).length, 1);
      assert.equal(result.observations.filter((item) => item.beta).length, 1);
      const foreign = probe(authority, { ...authority, pid: authority.pid + 1 });
      assert.equal(foreign.error, "IDENTITY_MISMATCH");
      assert.deepEqual(foreign.observations, []);
      const reused = probe(authority, {
        ...authority,
        launchIdentity: { ...authority.launchIdentity, seconds: authority.launchIdentity.seconds + 1 },
      });
      assert.equal(reused.error, "IDENTITY_MISMATCH");
      assert.deepEqual(reused.observations, []);
      report.requestTargetDriftRefused = true;
    } else if (mode === "navigate") {
      validateNavigationResult(result);
    } else {
      assert.equal(result.error, "BROWSER_DENIED", "UNEXPECTED_DOCUMENT_NOT_REFUSED");
      assert.deepEqual(result.observations, []);
    }
  } finally {
    clearTimeout(readyTimer);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    } else await closed;
  }
}

try {
  for (const mode of ["local", "iframe", "nested-iframe", "remote", "navigate"]) await runCase(mode);
  summary.complete = true;
} catch (error) {
  summary.failure = error.code ?? error.message;
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
