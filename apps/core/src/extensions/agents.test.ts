// The agents an extension brings: added to the owner's team from its page, and archived when it is removed, except
// one that answers a channel (DECISIONS.md#d-254).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let src: TempDir;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  src = tempDir("apx-ext-agents-");
  fs.writeFileSync(
    path.join(src.path, "apx-extension.json"),
    JSON.stringify({
      manifest: 2,
      id: "acme-crew",
      name: "Acme crew",
      version: "1.0.0",
      description: "Two ready-made agents.",
      agents: [
        { id: "planner", name: "Marketing planner", description: "Plans campaigns.", prompt: "Plan campaigns." },
        { id: "ops", name: "Data operations", description: "Bulk edits.", prompt: "Edit contacts in bulk." },
      ],
    }),
  );
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await src.remove();
});

test("an extension's agent joins the team once; removing the extension archives it, unless it answers a channel", async () => {
  const { store } = env.core;
  const seen = await env.client.call("extensions.inspect", { path: src.path });
  await env.client.call("extensions.install", { path: src.path, hash: seen.hash });
  const planner = await env.client.call("extensions.add_agent", { id: "acme-crew", agent: "planner" });
  assert.deepEqual(
    [planner.id, planner.name, planner.description],
    ["marketing-planner", "Marketing planner", "Plans campaigns."],
  );
  // Asked again, it is the same agent, not a second one.
  const again = await env.client.call("extensions.add_agent", { id: "acme-crew", agent: "planner" });
  assert.equal(again.id, planner.id);
  const ops = await env.client.call("extensions.add_agent", { id: "acme-crew", agent: "ops" });
  const listed = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "acme-crew");
  assert.deepEqual(
    listed?.added_agents?.map((a) => [a.agent, a.id]),
    [
      ["planner", "marketing-planner"],
      ["ops", "data-operations"],
    ],
  );

  // One of them answers a channel: archiving it would leave the channel answering as nobody.
  const saved = store.settings.read("channels");
  store.settings.write("channels", [
    ...saved,
    {
      id: "acme-line",
      type: "telegram",
      label: "Acme line",
      enabled: false,
      agent_id: ops.id,
      strangers: "pair",
      concurrency: "steer",
      owner_thread: "home",
    },
  ]);
  try {
    const removed = await env.client.call("extensions.remove", { id: "acme-crew" });
    assert.deepEqual(removed, { removed: true, archived: ["Marketing planner"], kept: ["Data operations"] });
    assert.equal(store.agents.active(planner.id), false);
    assert.equal(store.agents.active(ops.id), true);
    // Archived as the team's own Archive does: the owner can bring it back.
    const archived = (await env.client.call("agents.archived", {})).agents.map((a) => a.id);
    assert.ok(archived.includes(planner.id));
  } finally {
    store.settings.write("channels", saved);
  }
});
