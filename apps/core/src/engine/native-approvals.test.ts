import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "./testkit.ts";

const ran: string[] = [];
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said === "stamp") return callTool("s1", "acme_stamp", {});
  if (said === "shred") return callTool("s2", "acme_shred", { hard: true });
  if (said === "trim") return callTool("s3", "acme_shred", {});
  return say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({
    llm,
    extraTools: [
      defineTool({
        name: "acme_stamp",
        description: "Stamp a page",
        args: z.object({}),
        effect: "local",
        confirm: "ask",
        deadlineMs: 5_000,
        title: () => "Stamped",
        async run() {
          ran.push("stamp");
          return "stamped";
        },
      }),
      defineTool({
        name: "acme_shred",
        description: "Shred a page; hard leaves nothing",
        args: z.object({ hard: z.boolean().optional() }),
        effect: "local",
        confirm: (a) => (a.hard ? "always" : "ask"),
        deadlineMs: 5_000,
        title: () => "Shredded",
        async run() {
          ran.push("shred");
          return "shredded";
        },
      }),
    ],
  });
  await env.client.call("agents.create", { slug: "clerk", name: "Clerk" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Sends text in a new chat with the clerk; answers its confirmation, if one comes, with `decision`. */
async function ask(
  text: string,
  decision?: "approve" | "deny",
  scope?: "once" | "session" | "always",
  thread?: string,
) {
  const t = thread
    ? { id: thread }
    : await env.client.call("threads.create", { kind: "loose", agent_id: "clerk", title: "Desk" });
  await env.client.call("threads.send", { thread: t.id, text });
  const pending: Awaited<ReturnType<typeof env.client.call<"runs.pending">>>["inputs"] = await inputsOrEnd(
    env.client,
    t.id,
  );
  const input = pending[0];
  if (input && decision)
    await env.client.call("runs.respond", { input: input.id, decision, ...(scope ? { scope } : {}) });
  await env.settle(t.id);
  return input;
}

test("an always OK for one of APX's tools lets that agent use it without asking, until the owner revokes it", async () => {
  const first = await ask("stamp", "approve", "always");
  assert.deepEqual(first?.approval_scopes, ["once", "session", "always"]);
  assert.deepEqual(ran, ["stamp"]);

  assert.equal(await ask("stamp"), undefined, "the second time nobody is asked");
  assert.deepEqual(ran, ["stamp", "stamp"]);
  const grant = (await env.client.call("tools.approvals", {})).approvals.find((g) => g.key === "apx:acme_stamp");
  assert.equal(grant?.agent_id, "clerk");
  assert.equal(grant?.server, "apx");

  await env.client.call("tools.revoke", { key: "apx:acme_stamp", agent: "clerk" });
  assert.ok(await ask("stamp", "deny"), "revoked: it asks again");
  assert.deepEqual(ran, ["stamp", "stamp"]);
});

test("an action that always asks takes an OK for this chat, kept apart from the tool's ordinary grant", async () => {
  await env.client.call("tools.revoke", { key: "apx:acme_shred", agent: "clerk" });
  await ask("stamp", "approve", "always");
  const first = await ask("shred", "approve", "session");
  assert.deepEqual(first?.approval_scopes, ["once", "session", "always"]);
  assert.equal(first?.thread_id && (await ask("shred", undefined, undefined, first.thread_id)), undefined, "same chat");
  assert.equal(await ask("shred", "deny").then((i) => i?.tool), "acme_shred", "another chat asks again");

  await ask("shred", "approve", "always");
  assert.equal(await ask("shred"), undefined, "an always OK covers it in every chat");
  const keys = (await env.client.call("tools.approvals", {})).approvals.map((g) => g.key);
  assert.ok(keys.includes("apx:acme_shred#always"));
  await env.client.call("tools.revoke", { key: "apx:acme_shred#always", agent: "clerk" });
  assert.ok(await ask("shred", "deny"), "revoked: it asks again");
});

test("an always OK for a tool's ordinary calls does not cover its calls that always ask", async () => {
  await env.client.call("tools.revoke", { key: "apx:acme_shred#always", agent: "clerk" });
  await ask("trim", "approve", "always");
  assert.equal(await ask("trim"), undefined, "its ordinary call no longer asks");
  assert.ok(await ask("shred", "deny"), "its call that always asks still does");
});
