import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RETRY_MS,
  type Remote,
  reachRemote,
  SILENT_MS,
  type WaitDeps,
  waiting,
  waitingHtml,
  waitingText,
} from "./remote-wait.ts";

/** A fake world: the server answers from `upAt` (ms) on; sleeping moves the clock. */
function world(opts: { upAt?: number; loads?: boolean[]; current?: () => boolean } = {}) {
  let clock = 0;
  const shown: string[] = [];
  const loaded: string[] = [];
  const loads = [...(opts.loads ?? [])];
  const deps: WaitDeps = {
    current: opts.current ?? (() => true),
    isUp: async () => opts.upAt !== undefined && clock >= opts.upAt,
    load: async (url) => {
      loaded.push(url);
      return loads.shift() ?? true;
    },
    show: async (w) => {
      shown.push(waitingText(w));
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    es: false,
  };
  return { deps, shown, loaded, time: () => clock };
}

function tunnel(alive: (t: number) => boolean, time: () => number, problem?: string) {
  let restarts = 0;
  return {
    alive: () => alive(time()),
    problem: () => problem,
    restart: () => {
      restarts++;
    },
    restarts: () => restarts,
  };
}

test("a server restarting after an update is waited for on screen, then its panel loads by itself", async () => {
  const w = world({ upAt: 45_000 });
  const ssh = tunnel((t) => t >= 5_000, w.time, "ssh: connect to host box port 22: Connection refused");
  const remote: Remote = { where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh };
  assert.equal(await reachRemote(remote, w.deps), true);
  assert.deepEqual(w.loaded, ["http://127.0.0.1:7440"]);
  // Once while ssh cannot log in (with what ssh said), once while the server's APX is still starting.
  assert.equal(w.shown.length, 2);
  assert.match(w.shown[0] ?? "", /ops@box \(SSH\).*Connection refused/);
  assert.match(w.shown[1] ?? "", /SSH connection is up/);
  assert.ok(w.time() >= 45_000);
});

test("a forward that stays up with nothing answering through it is started again", async () => {
  const w = world({ upAt: SILENT_MS * 2 + RETRY_MS });
  const ssh = tunnel(() => true, w.time);
  await reachRemote({ where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh }, w.deps);
  assert.equal(ssh.restarts(), 2);
});

test("a load that fails puts the waiting text back instead of leaving a blank window", async () => {
  const w = world({ upAt: 0, loads: [false, true] });
  assert.equal(await reachRemote({ where: "http://box:7440", url: "http://box:7440" }, w.deps), true);
  assert.equal(w.loaded.length, 2);
  assert.equal(w.shown.length, 1);
});

test("changing connection ends the wait without loading anything", async () => {
  let checks = 0;
  const w = world({ current: () => ++checks < 4 });
  assert.equal(await reachRemote({ where: "http://box:7440", url: "http://box:7440" }, w.deps), false);
  assert.deepEqual(w.loaded, []);
});

test("the waiting text says how to pick another APX, in the app's language", () => {
  const remote: Remote = { where: "ops@box (SSH)", url: "http://127.0.0.1:7440" };
  assert.match(waitingText(waiting(remote, true, false)), /APX menu › Change connection/);
  assert.match(waitingText(waiting(remote, true, true)), /menú APX › Cambiar conexión/);
});

test("the waiting page keeps ssh's words apart and escaped", () => {
  const ssh = { alive: () => false, problem: () => "ssh: <host> refused", restart: () => {} };
  const html = waitingHtml(
    waiting({ where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh }, false, true),
    true,
  );
  assert.match(html, /<h1>Conectando con APX<\/h1>/);
  assert.match(html, /class="detail"><span>Detalle<\/span>ssh: &lt;host&gt; refused/);
});

test("the core on this computer waits with its own words and what to check", async () => {
  const w = world({ upAt: 3 * RETRY_MS });
  const local: Remote = { where: "127.0.0.1:7440", url: "http://127.0.0.1:7440", local: "See the log" };
  assert.equal(await reachRemote(local, w.deps), true);
  assert.equal(w.shown.length, 1);
  assert.match(w.shown[0] ?? "", /on this computer is not answering yet/);
  assert.match(w.shown[0] ?? "", /See the log/);
  assert.deepEqual(w.loaded, ["http://127.0.0.1:7440"]);
});

test("a confirmed local identity mismatch is explained without loading it, and a later matching core recovers", async () => {
  const w = world();
  const mismatch = "This port belongs to another home.";
  let problem: string | undefined;
  w.deps.isUp = async () => {
    if (w.time() === 0) {
      problem = mismatch;
      return false;
    }
    problem = undefined;
    return true;
  };
  const local: Remote = {
    where: "127.0.0.1:7440",
    url: "http://127.0.0.1:7440",
    local: "See the log",
    identityProblem: () => problem,
  };
  const load = w.deps.load;
  w.deps.load = async (url) => {
    assert.ok(w.time() >= RETRY_MS);
    assert.equal(problem, undefined);
    return load(url);
  };
  assert.equal(await reachRemote(local, w.deps), true);
  assert.equal(w.shown.length, 1);
  assert.ok(w.shown[0]?.includes(mismatch));
  assert.doesNotMatch(w.shown[0] ?? "", /is not answering yet/);
  assert.deepEqual(w.loaded, [local.url]);
  assert.match(waitingText(waiting(local, true, false)), /is not answering yet/);
});
