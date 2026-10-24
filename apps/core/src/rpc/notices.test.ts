import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 160)}`);
  if (said.includes("tell the owner")) return callTool("n1", "notify_owner", { text: "The deploy is done" });
  return say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const lastText = async (thread: string) =>
  JSON.stringify((await env.client.call("threads.get", { thread })).messages.at(-1)?.parts ?? []);

test("an agent tells the owner through the budget; it lands in the tray and the log under its own kind", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "when it ends, tell the owner" });
  await env.settle(t.id);
  // No channel in this core: the tray has it, and the agent is told so.
  assert.match(await lastText(t.id), /in the owner's tray/);
  const [n] = (await env.client.call("notices.log", { limit: 1 })).items;
  assert.equal(n?.kind, "agent:roby");
  assert.match(n?.text ?? "", /The deploy is done/);
  const tray = await env.client.call("notifications.list", {});
  assert.ok(tray.notifications.some((i) => i.kind === "agent" && i.thread_id === t.id));
});

test("not from a routine (its answer already reaches the owner), and only an agent at work may call it", async () => {
  const r = await env.client.call("routines.set", {
    name: "notify-probe",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "tell the owner it ran",
    enabled: true,
  });
  const { thread_id } = await env.client.call("routines.run", { routine: r.id });
  await env.settle(thread_id);
  assert.match(await lastText(thread_id), /already reaches the owner/);
  await assert.rejects(
    env.client.call("notices.notify", { text: "hi" }),
    (e: unknown) => e instanceof ApxError && e.code === "unauthorized",
  );
});
