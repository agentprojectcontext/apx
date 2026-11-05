import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

for (const key of ["OBSERVER_HELPER", "OBSERVER_ELECTRON", "OBSERVER_IDENTITY_PROBE", "OBSERVER_FIXTURE_DATA"]) {
  assert.ok(process.env[key], `Set ${key} to an isolated lab path`);
}
const children = [];
function launch(path, args = []) {
  const child = spawn(path, args, { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.on("error", () => {});
  children.push({ child, closed });
  child.stdin.on("error", () => {});
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function next() {
    let timer;
    try {
      return await Promise.race([
        lines.next().then((value) => {
          if (value.done) throw Error("FIXTURE_OR_HELPER_EOF");
          return value.value;
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("IO_DEADLINE")), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function request(object) {
    child.stdin.write(`${JSON.stringify(object)}\n`);
    return JSON.parse(await next());
  }
  return { child, next, request };
}
const forcedRendererAccessibility = process.env.OBSERVER_FORCE_RENDERER === "1";
const summary = { engine: "own observational helper", forcedRendererAccessibility, observations: [] };
try {
  const args = [fileURLToPath(new URL("electron-fixture.cjs", import.meta.url))];
  if (forcedRendererAccessibility) args.unshift("--force-renderer-accessibility");
  const app = launch(process.env.OBSERVER_ELECTRON, args);
  assert.equal(await app.next(), "FIXTURE_READY");
  const target = JSON.parse(
    execFileSync(process.env.OBSERVER_IDENTITY_PROBE, [String(app.child.pid)], {
      encoding: "utf8",
      timeout: 3000,
    }),
  );
  const helper = launch(process.env.OBSERVER_HELPER);
  assert.equal((await helper.request({ op: "hello" })).ready, true);
  let started = performance.now();
  const listing = await helper.request({ op: "listWindows", ...target });
  summary.listMs = Math.round(performance.now() - started);
  assert.ok(listing.listing, "No window listing");
  summary.windowCount = listing.listing.windows.length;
  summary.ambiguousWindows = listing.listing.windows.filter((window) => window.ambiguous).length;
  assert.equal(summary.windowCount, 2);
  assert.equal(summary.ambiguousWindows, 2);
  const labels = new Map();
  for (const { handle } of listing.listing.windows) {
    started = performance.now();
    const result = await helper.request({ op: "observeSelected", ...target, handle });
    const body = JSON.stringify(result);
    const label = body.includes("Fixture alpha") ? "alpha" : body.includes("Fixture beta") ? "beta" : null;
    summary.observations.push({
      ms: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(body),
      fixtureLabelFound: label !== null,
      error: result.error,
    });
    assert.ok(result.selectedObservation, "No selected observation");
    assert.equal(body.includes("SYNTHETIC_REDACTION_SENTINEL"), false);
    if (label !== null) labels.set(label, handle);
  }
  assert.equal(labels.size, 2, "ELECTRON_CONTENT_NOT_OBSERVED");
  summary.secureSentinelOmitted = true;
  app.child.stdin.write("close-alpha\n");
  assert.equal(await app.next(), "FIXTURE_DONE");
  const closed = await helper.request({ op: "observeSelected", ...target, handle: labels.get("alpha") });
  assert.equal(closed.error, "WINDOW_UNRESOLVED");
  assert.equal(closed.selectedObservation, undefined);
  summary.closedWindowRefused = true;
  summary.complete = true;
} catch (error) {
  summary.failure = error.message;
  process.exitCode = 1;
} finally {
  for (const { child, closed } of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await closed;
      } finally {
        clearTimeout(killTimer);
      }
    } else {
      await closed;
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
