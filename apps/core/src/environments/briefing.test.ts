import assert from "node:assert/strict";
import { test } from "node:test";
import { computerBriefing } from "./briefing.ts";

const base = {
  enabled: true,
  ready: true,
  name: "computer",
  workspace: "~/work",
  phase: "running" as const,
  supported: true,
  resources: { memory_gib: 4, cpus: 2, disk_gib: 24 },
  running_resources: { memory_gib: 2, cpus: 2, disk_gib: 16 },
  chat: { thread: "home", on: true },
  screens: [
    { screen: 1, agent: "roby", agent_name: "Roby", display: ":101", control: "agent" as const, changing: false },
  ],
};

test("an agent's briefing says the computer's real sizes, its screen, what it does and whose hands it is in", () => {
  const idle = computerBriefing(base as never, "roby", "home");
  assert.match(idle, /^Computer: running with 2 GiB memory, 2 CPUs, 16 GiB disk; this chat works on it\./);
  assert.match(idle, /Your screen: :101 \(screen 1\), idle, kept up after your last run\. Control: yours\./);
  const working = computerBriefing(
    { ...base, screens: [{ ...base.screens[0], thread: "home", run: "r1", control: "human" }] } as never,
    "roby",
    "home",
  );
  assert.match(working, /working in this chat\. Control: the owner has your screen in hand\. Do not act on it/);
  assert.match(
    computerBriefing({ ...base, restart: true } as never, "roby", "home"),
    /set 4 GiB memory, 2 CPUs, 24 GiB disk for its next start/,
  );
  assert.match(computerBriefing(base as never, "scout", "t2"), /Your screen: not up/);
  assert.ok(computerBriefing(base as never, "roby", "home").length < 400, "a few lines");
});

test("off or starting, the briefing says so and what the agent does about it", () => {
  const off = { ...base, phase: "stopped" as const, ready: false, last_stop: { reason: "idle" as const, at: "" } };
  assert.match(
    computerBriefing(off as never, "roby", "home"),
    /^Computer: off \(stopped after its idle minutes\); this chat works on it\. Start it only for work the owner wants on it; if they did not say, ask them first\./,
  );
  const starting = { ...base, phase: "preparing" as const, setup: true, chat: { thread: "t2", on: false } };
  assert.match(
    computerBriefing(starting as never, "roby", "t2"),
    /^Computer: being set up for the first time; this chat works on this Mac\. You get a turn/,
  );
});
