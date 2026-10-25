import assert from "node:assert/strict";
import { test } from "node:test";
import { agentComputer, screenChat, screensUp } from "./agent.ts";
import { computersOf } from "./summary.ts";

const status = {
  enabled: true,
  ready: true,
  name: "apx-computer",
  workspace: "~/work",
  supported: true,
  allowed_agents: 2,
  allowed: ["scout", "roby"],
  screens: [
    { screen: 1, agent: "scout", display: ":101", control: "agent" as const, changing: false, run: "run-1" },
    { screen: 2, agent: "roby", display: ":102", control: "agent" as const, changing: false },
  ],
};

test("a screen kept up after its run ended counts as in use, as the picker lists it", () => {
  assert.equal(screensUp(status), 2);
  assert.equal(screensUp({ ...status, screens: [] }), 0);
  assert.equal(screensUp(undefined), 0);
});

test("each agent's card tells whether it may use the computer and the screen it is up on", () => {
  const c = computersOf(status);
  assert.deepEqual(agentComputer(c, "scout"), { state: "running", screen: 1, held: true });
  assert.deepEqual(agentComputer(c, "roby"), { state: "running", screen: 2, held: false });
  assert.deepEqual(agentComputer(computersOf({ ...status, screens: [] }), "scout"), { state: "allowed" });
  assert.deepEqual(agentComputer(c, "writer"), { state: "off" });
  assert.equal(c.supported, true);
  assert.equal(computersOf({ ...status, supported: false }).supported, false);
});

test("a screen's chat is the run's that holds it, else its agent's chat on the computer", () => {
  const threads = { home: { agent_ids: ["roby"] }, t2: { agent_ids: ["scout"] } };
  const kept = { ...status, chats: ["t2", "home"] };
  const held = {
    screen: 1,
    agent: "scout",
    display: ":101",
    control: "agent" as const,
    changing: false,
    run: "r",
    thread: "t9",
  };
  assert.equal(screenChat({ ...kept, screens: [held] }, threads, "scout"), "t9");
  // Roby's screen stays up after its run: its chat is the one on the computer.
  assert.equal(screenChat(kept, threads, "roby"), "home");
  assert.equal(screenChat(kept, threads, "writer"), undefined);
  assert.equal(screenChat(undefined, threads, "roby"), undefined);
});
