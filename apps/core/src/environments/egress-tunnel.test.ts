import assert from "node:assert/strict";
import { test } from "node:test";
import { EGRESS_SOCKET, tunnelArgs } from "./egress-tunnel.ts";
import type { LimaRun } from "./lima-process.ts";
import { screenDriver } from "./provision.ts";

test("the egress tunnel ends at a guest socket only the Lima user can create, never a guest port an agent could take", () => {
  const args = tunnelArgs("/lima", "apx-test", 41234);
  const forward = args[args.indexOf("-R") + 1];
  assert.equal(forward, `${EGRESS_SOCKET}:127.0.0.1:41234`);
  assert.ok(EGRESS_SOCKET.startsWith("/run/apx-egress/"));
  assert.ok(!args.some((arg) => arg.includes(":3128")));
  assert.ok(args.includes("ExitOnForwardFailure=yes"));
});

test("a stopped screen's session never comes back by itself when the computer boots", async () => {
  const calls: string[][] = [];
  const run: LimaRun = async (args) => {
    calls.push(args);
    return "";
  };
  await screenDriver(run, "apx-test").stop(2);
  const at = (needle: string) => calls.findIndex((c) => c.join(" ").includes(needle));
  assert.ok(at("systemctl stop user@2002.service") >= 0);
  assert.ok(at("loginctl disable-linger apx-a2") > at("systemctl stop user@2002.service"));
});

function screenGuest(identity: string) {
  const calls: string[][] = [];
  const run: LimaRun = async (args) => {
    calls.push(args);
    return args.at(-1) === "id -u; id -G" ? identity : "";
  };
  return { run, started: () => calls.some((c) => c.join(" ").includes("apx-desktop@102")) };
}

test("a screen whose processes would keep root's group never starts its desktop", async () => {
  const leaked = screenGuest("2002\n2002 0\n");
  await assert.rejects(screenDriver(leaked.run, "apx-test").start(2, "dark", [2]), /wrong identity/);
  assert.equal(leaked.started(), false);
  const own = screenGuest("2002\n2002\n");
  await screenDriver(own.run, "apx-test").start(2, "dark", [2]);
  assert.equal(own.started(), true);
});
