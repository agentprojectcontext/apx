import assert from "node:assert/strict";
import { test } from "node:test";
import { egressRules, ensureSecured } from "./guest-security.ts";
import type { LimaRun } from "./lima-process.ts";

test("the probe user and agents reach loopback but never a resolver on it, so no name is looked up past the proxy", () => {
  const lines = egressRules()
    .split("\n")
    .map((l) => l.trim());
  for (const users of ["1001", "2001-2999"]) {
    const dns = lines.findIndex(
      (l) => l.startsWith(`meta skuid ${users} oifname "lo"`) && /th dport 53 reject/.test(l) && /tcp, udp/.test(l),
    );
    const loopback = lines.indexOf(`meta skuid ${users} oifname "lo" accept`);
    const rest = lines.indexOf(`meta skuid ${users} reject with icmpx type admin-prohibited`);
    assert.ok(dns >= 0, `${users}: no DNS rule`);
    assert.ok(dns < loopback && loopback < rest, `${users}: DNS must be refused before loopback is accepted`);
  }
  assert.ok(lines.includes("type filter hook forward priority -150; policy drop;"));
});

function guest(secured: boolean) {
  const steps: string[] = [];
  const run: LimaRun = async (args) => {
    if (args.includes("tee")) steps.push("rules");
    if (args.at(-1) === "-s") {
      steps.push("script");
      secured = true;
    }
    if (args.includes("-c") && args.at(-1)?.includes("print('isolated')")) {
      steps.push("verify");
      return secured ? "isolated\n" : "missing boundary\n";
    }
    return "";
  };
  return { run, steps };
}

test("a prepared computer that passes the check is not secured again", async () => {
  const { run, steps } = guest(true);
  await ensureSecured(true, run, "computer");
  assert.deepEqual(steps, ["verify"]);
});

test("a prepared computer missing a boundary runs the security script once and is checked after it", async () => {
  const { run, steps } = guest(false);
  await ensureSecured(true, run, "computer");
  assert.deepEqual(steps, ["verify", "rules", "script", "verify"]);
});

test("a computer not prepared yet is secured without a first check", async () => {
  const { run, steps } = guest(false);
  await ensureSecured(false, run, "computer");
  assert.deepEqual(steps, ["rules", "script", "verify"]);
});

test("a guest still failing after the script refuses to start", async () => {
  const { run } = guest(false);
  const stuck: LimaRun = async (args, options) => (args.at(-1) === "-s" ? "" : run(args, options));
  await assert.rejects(ensureSecured(true, stuck, "computer"), /security validation failed/);
});
