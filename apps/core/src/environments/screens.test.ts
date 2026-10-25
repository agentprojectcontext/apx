import assert from "node:assert/strict";
import { test } from "node:test";
import { computerChat, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { maxScreens, screenLedger } from "./screens.ts";

/** Each chat's turn waits until the test lets it end, so the screens it holds stay held. */
function heldTurns() {
  const waiting = new Map<string, () => void>();
  const started = new Set<string>();
  const llm = scriptedLlm(async (req) => {
    const said = String(req.messages.findLast((m) => m.role === "user")?.content ?? "");
    // The owner's words are the input's last line ("chat roby"); APX's own lines above them say "chat" too.
    const key = /^chat (\w+)$/.exec(said.split("\n").at(-1) ?? "")?.[1] ?? "";
    started.add(key);
    await new Promise<void>((resolve) => {
      waiting.set(key, resolve);
      req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say("Done");
  });
  return {
    llm,
    started: (key: string) => started.has(key),
    end: (key: string) => waiting.get(key)?.(),
    endAll: () => {
      for (const end of waiting.values()) end();
    },
  };
}

test("the VM's memory decides how many agent screens run at once", () => {
  assert.equal(maxScreens(2), 1);
  assert.equal(maxScreens(4), 2);
  assert.equal(maxScreens(6), 4);
  assert.equal(maxScreens(8), 5);
});

test("two agents hold two screens at once; a third is refused while the VM holds two, and gets the screen let go", async () => {
  const turns = heldTurns();
  const screens: string[] = [];
  const env = await startCore({
    llm: turns.llm,
    computer: {
      limaHome: "/unused",
      instance: "missing",
      screens: {
        start: async (n) => {
          screens.push(`start ${n}`);
        },
        stop: async (n) => {
          screens.push(`stop ${n}`);
        },
      },
    },
  });
  try {
    const chats: Record<string, string> = {};
    for (const agent of ["roby", "scout", "vera"]) {
      await env.client.call("environments.permit", { agent, on: true });
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
      await env.client.call("environments.bind", { thread: chat.id });
      chats[agent] = chat.id;
    }
    const send = (agent: string) =>
      env.client.call("threads.send", { thread: chats[agent] ?? "", text: `chat ${agent}` });
    await send("roby");
    await send("scout");
    await waitFor(() => turns.started("roby") && turns.started("scout"), "both turns started");
    const status = await env.client.call("environments.status", {});
    assert.equal(status.max_screens, 2);
    assert.deepEqual(
      status.screens?.map((s) => [s.screen, s.agent ?? "", s.thread ?? "", s.control]),
      [
        [1, "roby", chats.roby, "agent"],
        [2, "scout", chats.scout, "agent"],
      ],
    );
    assert.deepEqual(screens, ["start 1", "start 2"]);

    // Full: the third agent's turn is refused and says who holds the screens.
    await send("vera");
    const refused = await env.settle(chats.vera ?? "");
    assert.equal(refused.runs[0]?.state, "failed");
    assert.match(refused.runs[0]?.error ?? "", /all 2 screens the computer can hold are in use \(Roby, Scout\)/);
    assert.equal(turns.started("vera"), false, "no model call without a screen");

    // The same agent in a second chat waits for its own screen.
    const second = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("environments.bind", { thread: second.id });
    await env.client.call("threads.send", { thread: second.id, text: "chat other" });
    const busy = await env.settle(second.id);
    assert.match(busy.runs[0]?.error ?? "", /Roby.s screen is in use in another chat/);

    // Roby's turn ends: its screen is let go but stays up, and makes room for Vera.
    turns.end("roby");
    await env.settle(chats.roby ?? "");
    assert.deepEqual(
      env.core.store.settings.read("computer_claims").map((c) => c.agent),
      ["scout"],
    );
    await send("vera");
    await waitFor(() => turns.started("vera"), "the third turn started");
    assert.deepEqual(screens, ["start 1", "start 2", "stop 1", "start 3"]);
    assert.deepEqual(
      (await env.client.call("environments.status", {})).screens?.map((s) => [s.screen, s.agent ?? ""]),
      [
        [2, "scout"],
        [3, "vera"],
      ],
    );
  } finally {
    turns.endAll();
    await env.core.close();
    env.cleanup();
  }
});

test("claims of runs that are over are swept, as after a restart", async () => {
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: "/unused", instance: "missing" },
  });
  try {
    env.core.store.settings.write("computer_claims", [
      { screen: 1, agent: "roby", thread: "home", run: "run_gone", at: new Date().toISOString() },
    ]);
    assert.deepEqual((await env.client.call("environments.status", {})).screens, []);
    assert.deepEqual(env.core.store.settings.read("computer_claims"), []);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a screen still starting counts as use, so the idle watchdog never stops the computer under it", async () => {
  let started: () => void = () => {};
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: {
      limaHome: "/unused",
      instance: "missing",
      screens: {
        start: () =>
          new Promise<void>((resolve) => {
            started = resolve;
          }),
        stop: async () => {},
      },
    },
  });
  try {
    const chat = await computerChat(env);
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    const vm = env.core.computer;
    const before = vm.lastActivity();
    const claiming = vm.claim("roby", chat, "run_starting");
    await waitFor(() => vm.inUse(), "a claim in progress to count as use");
    assert.ok(vm.lastActivity() >= before, "touched before the screen starts");
    started();
    await claiming;
  } finally {
    started();
    await env.core.close();
    await env.cleanup();
  }
});

test("a screen that never starts fails its claim at the deadline, and the next claim is not held behind it", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const ledger = screenLedger(store, {
      cap: () => 4,
      claimMs: 200,
      screens: {
        start: (screen, signal) =>
          screen === 1
            ? new Promise<void>(() => {})
            : signal.aborted
              ? Promise.reject(signal.reason)
              : Promise.resolve(),
        stop: async () => {},
      },
    });
    const late = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("still waiting after 3 s")), 3000).unref();
    });
    await assert.rejects(Promise.race([ledger.claim("roby", "home", "run_stuck"), late]), /did not start in time/);
    const next = await waitFor(
      () =>
        ledger.claim("scout", "home", "run_next").then(
          (c) => c,
          () => undefined,
        ),
      "the next claim",
      { ms: 2000 },
    );
    assert.equal(next.agent, "scout");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
