import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { computerApproval, createComputer } from "./computer.ts";

test("a computer grant for one chat covers only the agent it was given to, and taking it away ends it in every chat", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const vm = createComputer(env.core.store, { limaHome: "/unused", instance: "missing" });
  try {
    // A chat whose first agent is Roby, where Scout was let use the computer for that chat only.
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    env.core.store.approvals.grant(computerApproval, "session", chat.id, "scout");
    assert.equal(vm.permitted("scout", chat.id), true);
    assert.equal(vm.permitted("roby", chat.id), false, "another agent in the same chat is not covered");
    assert.equal(vm.permitted("scout", "home"), false, "nor the same agent in another chat");
    vm.permit("scout", false);
    assert.equal(vm.permitted("scout", chat.id), false, "revoked even where it is not the chat's first agent");
  } finally {
    await vm.close();
    await env.core.close();
    await env.cleanup();
  }
});
