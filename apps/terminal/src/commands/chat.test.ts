import assert from "node:assert/strict";
import { test } from "node:test";
import { latestConversation } from "./chat.ts";

test("--agent writes in the agent's latest conversation, never in a routine run, a task or a code session", () => {
  const threads = [
    { id: "run", kind: "routine", agent_ids: ["scout"] },
    { id: "task", kind: "task", agent_ids: ["scout"] },
    { id: "code", kind: "code", agent_ids: ["scout"] },
    { id: "talk", kind: "agent", agent_ids: ["scout"] },
    { id: "other", kind: "agent", agent_ids: ["vera"] },
  ];
  assert.equal(latestConversation(threads, "scout"), "talk");
  assert.equal(latestConversation(threads.slice(0, 3), "scout"), undefined);
});
