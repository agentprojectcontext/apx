import assert from "node:assert/strict";
import { test } from "node:test";
import { agentLoopbackRules } from "./loopback.ts";
import { browserArgs, screenArgs, screenSlice, workerArgs } from "./worker.ts";

test("each agent's loopback listeners refuse new connections from any other agent, and nothing else changes", () => {
  const rules = agentLoopbackRules([2, 1, 2]);
  assert.equal(
    rules,
    [
      "table inet apx_loopback {",
      "  chain output {",
      "    type filter hook output priority -160; policy accept;",
      '    oifname "lo" meta skuid 2001 meta mark set 0x000007d1',
      '    oifname "lo" meta skuid 2002 meta mark set 0x000007d2',
      "  }",
      "  chain input {",
      "    type filter hook input priority -160; policy accept;",
      '    iifname "lo" ct state new socket cgroupv2 level 2 "user.slice/user-2001.slice" meta mark != 0x000007d1 reject with icmpx type port-unreachable',
      '    iifname "lo" ct state new socket cgroupv2 level 2 "user.slice/user-2002.slice" meta mark != 0x000007d2 reject with icmpx type port-unreachable',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  // Only agents' own slices are named: the proxy, the guest's services and other users keep their loopback.
  assert.doesNotMatch(rules, /policy drop|user-1001|user-1000|system\.slice/);
  assert.match(
    agentLoopbackRules([]),
    /chain input \{\n {4}type filter hook input priority -160; policy accept;\n {2}\}/,
  );
  assert.throws(() => agentLoopbackRules([0]), /invalid screen/);
});

test("an agent's processes run as its user, with its own groups only, inside its own slice; the probe user keeps plain sudo", () => {
  assert.equal(screenSlice(3), "user-2003.slice");
  assert.deepEqual(screenArgs(3, "/usr/local/bin/apx-command", "--cancel", "op"), [
    "sudo",
    "-n",
    "systemd-run",
    "--quiet",
    "--scope",
    "--slice=user-2003.slice",
    "--",
    "setpriv",
    "--reuid=apx-a3",
    "--regid=apx-a3",
    "--init-groups",
    "--",
    "env",
    "HOME=/home/apx-a3",
    "USER=apx-a3",
    "LOGNAME=apx-a3",
    "XDG_RUNTIME_DIR=/run/user/2003",
    "/usr/local/bin/apx-command",
    "--cancel",
    "op",
  ]);
  assert.deepEqual(workerArgs("id").slice(0, 4), ["sudo", "-n", "-u", "apx-worker"]);
});

test("each screen's browser logs in its own user's home, never in a folder other agents share", () => {
  const one = browserArgs(1);
  const two = browserArgs(2);
  assert.equal(one.at(-2), "/usr/local/bin/apx-browser");
  assert.equal(one.at(-1), "/home/apx-a1/.cache/apx/browser.log");
  assert.equal(two.at(-1), "/home/apx-a2/.cache/apx/browser.log");
  assert.ok(![...one, ...two].some((arg) => arg.startsWith("/tmp/")));
});

test("on WSL, without socket matching, replies cross only between an agent and itself or the egress proxy", () => {
  const rules = agentLoopbackRules([1], true);
  assert.equal(
    rules,
    [
      "table inet apx_loopback {",
      "  chain output {",
      "    type filter hook output priority -160; policy accept;",
      '    oifname "lo" ct state new meta skuid 2001 ct mark set 0x000007d1',
      '    oifname "lo" ct direction reply meta skuid 2001 ct mark != 0x000007d1 drop',
      '    oifname "lo" ct direction reply ct mark 0x000007d1 meta skuid != 2001 th sport != 3128 drop',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(rules, /socket cgroupv2/);
});
