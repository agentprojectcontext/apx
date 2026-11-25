// A chat started from an outside app's chat works for that app, not the owner: it keeps the walls (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Thread } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { agentTools } from "./agents.ts";
import type { ToolContext } from "./types.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a chat opened from an outside app's chat cannot stop a session of the owner's other chats", async () => {
  const store = env.core.store;
  const agent = store.agents.get("superagent");
  assert.ok(agent);
  const owners = store.threads.create({ kind: "loose", title: "Northwind build", agent_ids: ["superagent"] });
  const session = store.threads.create({
    kind: "a2a",
    title: "Northwind review",
    agent_ids: ["superagent"],
    parent_id: owners.id,
    session: "review",
  });
  const app = store.threads.create({ kind: "loose", title: "Outside app", agent_ids: ["superagent"] });
  store.threads.mergeContext(app.id, { client: "external" });
  const opened = (parent: string) =>
    store.threads.create({ kind: "a2a", title: "Helper", agent_ids: ["superagent"], parent_id: parent });
  const stop = agentTools(store).find((t) => t.name === "stop_session");
  assert.ok(stop);
  const stopped: string[] = [];
  const from = (thread: Thread) =>
    stop.run({ session: session.id }, {
      agent,
      thread,
      call: async (_method: string, p: { thread: string }) => {
        stopped.push(p.thread);
        return { canceled: true };
      },
    } as unknown as ToolContext);
  assert.match(await from(opened(app.id)), /no session "\S+" in this thread/);
  assert.deepEqual(stopped, []);
  // The same chat opened from the owner's reaches it, and says where.
  assert.match(await from(opened(owners.id)), /session "review" stopped in chat Northwind build \(Home\)/);
  assert.deepEqual(stopped, [session.id]);
});
