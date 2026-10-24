import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseCoreEnv } from "@apx/protocol";
import { createAccess, type TailscaleRun, tailscaleRunner } from "./access.ts";

const fakeTailscale = (calls: string[][], connected = true): TailscaleRun => {
  return async (args) => {
    calls.push(args);
    if (args[0] === "status")
      return connected
        ? { ok: true, out: JSON.stringify({ Self: { DNSName: "box.tail0.ts.net." } }) }
        : { ok: false, out: "" };
    return { ok: true, out: "" };
  };
};

function setup(o: { tailscale?: TailscaleRun; restart?: () => void; running?: { host: string; publicUrl?: string } }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-access-"));
  const access = createAccess({
    home,
    running: { host: o.running?.host ?? "127.0.0.1", publicUrl: o.running?.publicUrl, token: undefined },
    port: () => 7440,
    addresses: () => ["http://192.0.2.10:7440"],
    restart: o.restart,
    tailscale: o.tailscale,
  });
  const env = () => parseCoreEnv(fs.readFileSync(path.join(home, "core.env"), "utf8"));
  return { home, access, env, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("the local network: saved with a token, and a supervised core restarts to take it", async () => {
  let restarted = 0;
  const s = setup({ tailscale: fakeTailscale([]), restart: () => restarted++ });
  assert.equal((await s.access.state()).mode, "local");
  const r = await s.access.set("lan");
  assert.deepEqual([r.mode, r.saved, r.restart_needed, r.restarting], ["local", "lan", true, true]);
  assert.equal(s.env().APX_HOST, "0.0.0.0");
  assert.ok(s.env().APX_TOKEN);
  const mode = fs.statSync(path.join(s.home, "core.env")).mode & 0o777;
  // Windows exposes the writable bit, not POSIX owner/group permissions.
  assert.equal(mode, process.platform === "win32" ? 0o666 : 0o600);
  await new Promise((done) => setTimeout(done, 600));
  assert.equal(restarted, 1);
  s.done();
});

test("Tailscale: serves the core on the tailnet's https name, and back to local undoes only that", async () => {
  const calls: string[][] = [];
  const s = setup({ tailscale: fakeTailscale(calls) });
  const r = await s.access.set("tailscale");
  assert.equal(r.saved, "tailscale");
  assert.equal(r.restarting, false, "nothing restarts an unsupervised core");
  assert.equal(s.env().APX_PUBLIC_URL, "https://box.tail0.ts.net");
  const serves = () => calls.filter((c) => c[0] === "serve");
  assert.deepEqual(serves(), [["serve", "--bg", "--https=443", "http://127.0.0.1:7440"]]);
  const token = s.env().APX_TOKEN;
  await s.access.set("local");
  assert.deepEqual(serves().at(-1), ["serve", "--https=443", "off"]);
  assert.equal(s.env().APX_PUBLIC_URL, undefined);
  assert.equal(s.env().APX_TOKEN, token, "the token stays");
  s.done();
});

test("Tailscale missing or disconnected is refused with a reason, and nothing is saved", async () => {
  const disconnected = setup({ tailscale: fakeTailscale([], false) });
  await assert.rejects(disconnected.access.set("tailscale"), /not connected/);
  assert.equal(fs.existsSync(path.join(disconnected.home, "core.env")), false);
  assert.equal((await disconnected.access.state()).tailscale.installed, true);
  assert.equal((await disconnected.access.state()).tailscale.connected, false);
  disconnected.done();
});

test("what runs now is told apart from what was saved", async () => {
  const s = setup({ tailscale: fakeTailscale([]), running: { host: "0.0.0.0" } });
  const now = await s.access.state();
  assert.deepEqual(now.urls, ["http://192.0.2.10:7440"]);
  assert.equal(now.mode, "lan");
  assert.equal(now.restart_needed, true, "core.env does not say lan yet");
  s.done();
});

test("the Tailscale subprocess receives CLI mode when launched outside a shell, without blocking the core", async () => {
  const run = tailscaleRunner(process.execPath);
  let ticked = false;
  setImmediate(() => {
    ticked = true;
  });
  const result = await run(["-e", "process.stdout.write(process.env.TAILSCALE_BE_CLI ?? 'missing')"]);
  assert.deepEqual(result, { ok: true, out: "1" });
  assert.ok(ticked, "the event loop ran while the CLI did");
});
