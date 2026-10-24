import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pendingInput, say, scriptedLlm, startCore, texts } from "../../engine/testkit.ts";
import { realpath } from "../../paths.ts";
import { tempDir } from "../../testkit/platform.ts";
import { openSession } from "./agents.ts";

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
  await env.cleanup();
});

test("an ACP agent's session runs the turn: model picked, its edit asks the owner, its tool shown, session kept", async () => {
  // In manual mode its edit asks; auto would let it edit its folder unasked (DECISIONS.md#d-106).
  await env.client.call("agents.update", { agent: "scout", autonomy: "manual" });
  // The executable is node itself; the agent's args point at the fake.
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-acp-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "scout",
    project_id: project,
    engine: "acp:fake",
  });
  await env.client.call("threads.model", { thread: t.id, model_choice: { model: "acp:fake/m2", router: false } });
  const sent = await env.client.call("threads.send", { thread: t.id, text: "edit the notes" });
  const input = await pendingInput(env.client, t.id);
  assert.equal(input.tool, "edit");
  assert.match(input.prompt ?? "", /usar Edit notes.md/);
  await env.client.call("runs.respond", { input: input.id, decision: "approve" });
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
  const asked = await pendingInput(env.client, t.id);
  await env.client.call("runs.respond", { input: asked.id, decision: "deny" });
  await env.client.call("runs.wait", { run: again.run.id, timeout_s: 10 });
  const after2 = await env.settle(t.id);
  assert.ok(texts(after2.messages).includes("model=m2 edit=rejected instructions=false"));
});

test("a CLI nobody signed in to ends the session with how to sign in, and APX never signs it in itself", async () => {
  const dir = tempDir("apx-acp-auth-");
  const log = path.join(dir.path, "auth.log");
  const agent = {
    id: "fake",
    label: "Fake ACP",
    command: process.execPath,
    args: [FAKE],
    login: "fake login",
    env: { FAKE_SIGNED_OUT: "1", FAKE_AUTH_LOG: log },
  };
  try {
    await assert.rejects(
      openSession(agent, { binary: process.execPath, cwd: os.tmpdir() }),
      /Fake ACP is not signed in: run fake login in a terminal/,
    );
    // Its auth method opens the owner's browser from turns and model listings nobody watches.
    assert.equal(fs.existsSync(log), false);
  } finally {
    // openSession settles only once the CLI is gone, so nothing holds the folder any more.
    await dir.remove();
  }
});
