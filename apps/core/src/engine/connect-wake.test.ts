import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { wakeAfterConnect } from "./connect-wake.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said }) =>
  said.includes("the owner connected") ? say("Linear is in: going on.") : say("ok"),
);

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const connectedRuns = async () =>
  (await env.client.call("threads.get", { thread: "home" })).runs.filter(
    (r) => env.core.store.runs.get(r.id)?.input?.origin.kind === "connected",
  );

test("connecting what an agent offered on a card wakes it, even after it wrote again, and only once", async () => {
  const store = env.core.store;
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  assert.ok(boss);
  const card = store.messages.add({
    thread_id: "home",
    author: { kind: "agent", id: boss.id },
    parts: [
      {
        type: "connect",
        why: "To read your issues.",
        offers: [{ kind: "integration", id: "linear", label: "Linear", description: "Issues." }],
      },
    ],
  });
  // The agent went on talking: the card is no longer the chat's last message.
  store.messages.add({
    thread_id: "home",
    author: { kind: "agent", id: boss.id },
    parts: [{ type: "text", text: "Meanwhile…" }],
  });

  await env.client.call("integrations.connect", { id: "linear", values: {} });
  await waitFor(async () => (await connectedRuns()).length === 1, "a turn for the connection");
  await waitFor(async () => (await connectedRuns()).every((r) => r.ended_at), "the turn ends");
  const run = store.runs.get((await connectedRuns())[0]?.id ?? "");
  assert.equal(run?.agent_id, boss.id);
  assert.deepEqual(run?.input?.origin, {
    kind: "connected",
    what: "integration",
    id: "linear",
    label: "Linear",
    message_id: card.id,
  });
  assert.ok(llm.calls.some((c) => /the owner connected .*Linear/.test(String(c.messages.at(-1)?.content))));

  await env.client.call("integrations.disconnect", { id: "linear" });
  await env.client.call("integrations.connect", { id: "linear", values: {} });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await connectedRuns()).length, 1, "an answered card is not answered again");
});

test("a card from days ago, or one offering something else, wakes nobody", async () => {
  const store = env.core.store;
  const before = (await connectedRuns()).length;
  wakeAfterConnect(store, env.core.engine.admit, { what: "integration", id: "notion" });
  wakeAfterConnect(store, env.core.engine.admit, { what: "integration", id: "linear" }, Date.now() + 3 * 86_400_000);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await connectedRuns()).length, before);
});
