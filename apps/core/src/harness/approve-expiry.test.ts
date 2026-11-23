import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";
import type { Harness } from "./index.ts";

// Like Claude Code's canUseTool: asks about one high-impact command, then reports what it was told.
const claude: Harness = {
  id: "claude",
  async run(io) {
    const callId = `${io.run.id}-p1`;
    const input = { command: "sudo ls" };
    const ok = await io.approve({ callId, title: "Bash sudo ls", kind: "execute", input });
    return { text: JSON.stringify({ ok, why: io.refusal?.(callId) }), model: "claude/model", sessionId: "s" };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
const repo = tempDir("apx-expiry-");
before(async () => {
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    harnesses: { claude },
    inputWaits: { turn: 150, external: 150 },
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

test("a card nobody answers comes back to an outside agent as a clear no, and its turn still ends well", async () => {
  const project = (await env.client.call("projects.register", { path: realpath(repo.path), init: true })).project.id;
  const thread = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project,
    engine: "claude",
  });
  await env.client.call("threads.send", { thread: thread.id, text: "go" });
  const done = await env.settle(thread.id);
  const said = JSON.parse(texts(done.messages.slice(-1))[0] ?? "{}") as { ok: boolean; why?: string };
  assert.equal(said.ok, false);
  assert.match(said.why ?? "", /did not answer in time/);
  assert.match(said.why ?? "", /continue another way/);
  assert.equal(done.runs.at(-1)?.state, "completed");
});
