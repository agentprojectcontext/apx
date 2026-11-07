import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ObserverReader } from "../observer-reader.ts";

const executable = process.env.OBSERVER_HELPER;
const home = process.env.OBSERVER_SCRATCH;
const fixture = process.env.OBSERVER_NATIVE_FIXTURE;
const identityProbe = process.env.OBSERVER_IDENTITY_PROBE;
assert.ok(
  executable && home && fixture && identityProbe,
  "Set explicit isolated helper, scratch, fixture and identity probe paths",
);
const env = { HOME: home, LANG: "C", LC_ALL: "C" };
const app = spawn(fixture, [], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
const closed = new Promise<void>((resolve) => app.once("close", () => resolve()));
app.on("error", () => {});
app.stdin.on("error", () => {});
app.stderr.resume();
const lines = createInterface({ input: app.stdout })[Symbol.asyncIterator]();
const reader = new ObserverReader({ executable, home });
const summary: Record<string, unknown> = { complete: false };
async function next() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lines.next().then((value) => {
        if (value.done) throw new Error("FIXTURE_EOF");
        return value.value;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("FIXTURE_DEADLINE")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function command(value: string) {
  app.stdin.write(`${value}\n`);
  assert.equal(await next(), "FIXTURE_DONE");
}
try {
  assert.equal(await next(), "FIXTURE_READY");
  assert.ok(app.pid);
  const target: { pid: number; launchIdentity: { seconds: number; microseconds: number } } = JSON.parse(
    execFileSync(identityProbe, [String(app.pid)], { cwd: home, env, encoding: "utf8", timeout: 3000 }),
  );
  assert.equal(target.pid, app.pid);
  const started = performance.now();
  const listing = await reader.request({ op: "listWindows", ...target });
  summary.listMs = Math.round(performance.now() - started);
  assert.equal(listing.kind, "listing");
  if (listing.kind !== "listing") throw new Error("LISTING_REFUSED");
  assert.equal(listing.windows.length, 2);
  assert.ok(listing.windows.every((window) => window.title === "Acme identical windows" && window.ambiguous));
  summary.twoAmbiguousDescriptors = true;
  const handles = new Map<string, string>();
  const samples: number[] = [];
  for (const window of listing.windows) {
    const started = performance.now();
    const observed = await reader.request({ op: "observeSelected", ...target, handle: window.handle });
    samples.push(Math.round(performance.now() - started));
    assert.equal(observed.kind, "observation");
    const body = JSON.stringify(observed);
    assert.equal(body.includes("SYNTHETIC_REDACTION_SENTINEL"), false);
    const alpha = body.includes("Fixture alpha");
    const beta = body.includes("Fixture beta");
    assert.notEqual(alpha, beta);
    handles.set(alpha ? "alpha" : "beta", window.handle);
  }
  assert.equal(handles.size, 2);
  summary.observationMs = samples;
  summary.distinctControlsAndSentinelOmitted = true;
  const alpha = handles.get("alpha");
  assert.ok(alpha);
  await command("reorder");
  const reordered = await reader.request({ op: "observeSelected", ...target, handle: alpha });
  assert.equal(reordered.kind, "observation");
  assert.ok(JSON.stringify(reordered).includes("Fixture alpha"));
  summary.reorderPreservesWindow = true;
  await command("replace-alpha");
  assert.deepEqual(await reader.request({ op: "observeSelected", ...target, handle: alpha }), {
    kind: "error",
    code: "WINDOW_UNRESOLVED",
  });
  summary.replacedWindowRefused = true;
  const relisted = await reader.request({ op: "listWindows", ...target });
  assert.equal(relisted.kind, "listing");
  if (relisted.kind !== "listing") throw new Error("RELIST_REFUSED");
  let beta: string | undefined;
  for (const window of relisted.windows) {
    const observed = await reader.request({ op: "observeSelected", ...target, handle: window.handle });
    assert.equal(observed.kind, "observation");
    if (JSON.stringify(observed).includes("Fixture beta")) beta = window.handle;
  }
  assert.ok(beta);
  await command("close-beta");
  assert.deepEqual(await reader.request({ op: "observeSelected", ...target, handle: beta }), {
    kind: "error",
    code: "WINDOW_UNRESOLVED",
  });
  summary.closedWindowRefused = true;
  await assert.rejects(
    reader.request({ op: "observeSelected", ...target, handle: alpha }),
    /^Error: OBSERVER_READ_FAILED$/,
  );
  summary.retiredSelectionRefused = true;
  summary.complete = true;
} catch {
  summary.failure = "VALIDATED_NATIVE_FIXTURE_FAILED";
  process.exitCode = 1;
} finally {
  await reader.stop();
  if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL");
  await closed;
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
