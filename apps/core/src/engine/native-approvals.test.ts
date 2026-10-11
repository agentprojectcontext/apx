import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const ran: string[] = [];
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said === "stamp") return callTool("s1", "acme_stamp", {});
  if (said === "shred") return callTool("s2", "acme_shred", {});
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
        description: "Shred a page",
        args: z.object({}),
        effect: "local",
        confirm: "always",
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
  env.cleanup();
});

/** Sends text in a new chat with the clerk; answers its confirmation, if one comes, with `decision`. */
async function ask(text: string, decision?: "approve" | "deny", scope?: "once" | "session" | "always") {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "clerk", title: "Desk" });
  await env.client.call("threads.send", { thread: t.id, text });
  let pending: Awaited<ReturnType<typeof env.client.call<"runs.pending">>>["inputs"] = [];
  for (let i = 0; i < 40 && !pending.length; i++) {
    pending = (await env.client.call("runs.pending", { thread: t.id })).inputs;
    if (!pending.length) await new Promise((r) => setTimeout(r, 20));
  }
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

test("an action that always asks offers no lasting OK", async () => {
  const input = await ask("shred", "approve");
  assert.equal(input?.approval_scopes, undefined);
  assert.equal(await ask("shred", "deny").then((i) => i?.tool), "acme_shred", "it asks again the next time");
});
