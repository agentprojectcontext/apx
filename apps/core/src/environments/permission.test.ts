import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, computerChat, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
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

test("an agent whose permission is taken away mid-turn cannot drive the guest browser for the rest of it", async () => {
  let go: () => void = () => {};
  const revoked = new Promise<void>((resolve) => {
    go = resolve;
  });
  let asked = false;
  const llm = scriptedLlm(async (_req, { afterTool }) => {
    if (afterTool) return say("Stopped");
    asked = true;
    await revoked;
    return callTool("open", "browser_open", { url: "https://example.com" });
  });
  const env = await startCore({ llm, computer: { limaHome: "/unused", instance: "missing" } });
  try {
    const chat = await computerChat(env);
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await env.client.call("threads.send", { thread: chat, text: "Open a page" });
    await waitFor(() => asked, "the turn to start");
    await env.client.call("environments.permit", { agent: "roby", on: false });
    go();
    const result = await env.settle(chat);
    const card = result.messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "browser_open");
    assert.equal(card?.type === "tool" && card.status, "error");
    assert.match(card?.type === "tool" ? (card.detail ?? "") : "", /may not use the computer/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
