import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore, texts } from "../../engine/testkit.ts";

const FAKE = path.join(import.meta.dirname, "fake-agent.test-support.mjs");

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("native")) });
  env.core.store.settings.set(
    "acp_agents",
    JSON.stringify([{ id: "fake", label: "Fake ACP", command: process.execPath, args: [FAKE] }]),
  );
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("an ACP agent's session runs the turn: model picked, its edit asks the owner, its tool shown, session kept", async () => {
  // The executable is node itself; the agent's args point at the fake.
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-acp-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "scout",
    project_id: project,
    engine: "acp:fake",
  });
  await env.client.call("threads.model", { thread: t.id, model_choice: { model: "acp:fake/m2", router: false } });
  const sent = await env.client.call("threads.send", { thread: t.id, text: "edit the notes" });
  let inputs: Awaited<ReturnType<typeof env.client.call<"runs.pending">>>["inputs"] = [];
  for (let i = 0; i < 200 && !inputs.length; i++) {
    inputs = (await env.client.call("runs.pending", { thread: t.id })).inputs;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(inputs[0]?.tool, "edit");
  assert.match(inputs[0]?.prompt ?? "", /para usar Edit notes.md/);
  await env.client.call("runs.respond", { input: inputs[0]?.id ?? "", decision: "approve" });
  const done = await env.client.call("runs.wait", { run: sent.run.id, timeout_s: 10 });
  assert.equal(done.state, "completed");
  assert.equal(done.harness, "acp");
  assert.equal(done.model, "acp:fake/m2");
  const { messages } = await env.settle(t.id);
  // A session is the agent itself: no agent's instructions go in (DECISIONS.md#d-023).
  assert.ok(texts(messages).includes("model=m2 edit=allowed instructions=false"));
  const card = messages.at(-1)?.parts.find((p) => p.type === "tool");
  assert.equal(card?.type === "tool" && card.status, "ok");
  assert.equal(env.core.store.harnessSessions.get(t.id, "acp:fake"), "fake-session-1");

  // The next turn loads the same session.
  const again = await env.client.call("threads.send", { thread: t.id, text: "again" });
  for (let i = 0; i < 200; i++) {
    const p = (await env.client.call("runs.pending", { thread: t.id })).inputs[0];
    if (p) {
      await env.client.call("runs.respond", { input: p.id, decision: "deny" });
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  await env.client.call("runs.wait", { run: again.run.id, timeout_s: 10 });
  const after2 = await env.settle(t.id);
  assert.ok(texts(after2.messages).includes("model=m2 edit=rejected instructions=false"));
});
