import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Harness } from "../harness/index.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore, texts } from "./testkit.ts";

/** A path as a command names it: forward slashes, which Git Bash reads on Windows too. */
const sh = (p: string) => p.split(path.sep).join("/");

// "probe [...]" asks the core about each of its own tool calls, as Claude Code's canUseTool does.
const claude: Harness = {
  id: "claude",
  async run(io) {
    const asked = JSON.parse(/^probe (\[.*\])$/m.exec(String(io.input.content))?.[1] ?? "[]") as Array<{
      kind: string;
      command?: string;
      path?: string;
    }>;
    const said: boolean[] = [];
    for (const [i, a] of asked.entries()) {
      const input = a.command === undefined ? { path: a.path } : { command: a.command };
      said.push(await io.approve({ callId: `${io.run.id}-p${i}`, title: a.kind, kind: a.kind, input }));
    }
    return { text: JSON.stringify(said), model: "claude/model", sessionId: "probe" };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("native")), harnesses: { claude } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function session() {
  const repo = tempDir("apx-harness-card-").path;
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const thread = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project,
    engine: "claude",
  });
  return { thread, repo };
}

async function probe(thread: string, asks: object[], answer?: { decision: "approve" | "deny"; scope?: "always" }) {
  await env.client.call("threads.send", { thread, text: `probe ${JSON.stringify(asks)}` });
  let card: Awaited<ReturnType<typeof env.client.call<"runs.pending">>>["inputs"][number] | undefined;
  if (answer) {
    card = await waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0], "a card");
    await env.client.call("runs.respond", { input: card.id, ...answer });
  }
  const t = await env.settle(thread);
  return { card, said: texts(t.messages.slice(-1))[0] };
}

test("an outside agent's change outside its folders offers the same folder card as ours: once or always for this agent", async () => {
  const { thread, repo } = await session();
  await using away = tempDir("apx-away-");
  await env.client.call("agents.update", { agent: "superagent", autonomy: "auto" });
  const edit = { kind: "execute", command: `touch ${sh(away.path)}/made.txt` };
  try {
    const first = await probe(thread.id, [edit], { decision: "approve", scope: "always" });
    assert.deepEqual(first.card?.folders, [away.path]);
    assert.deepEqual(first.card?.approval_scopes, ["once", "always"]);
    assert.match(first.card?.prompt ?? "", /fuera de su proyecto|outside its project/);
    assert.equal(first.said, "[true]");
    // Kept for this agent: the next change there asks nothing.
    const again = await probe(thread.id, [edit, { kind: "edit", path: path.join(away.path, "b.txt") }]);
    assert.equal(again.said, "[true,true]");
    const grant = env.core.store.approvals.list().find((g) => g.tool === "write_folder");
    assert.equal(grant?.condition, away.path);
  } finally {
    for (const g of env.core.store.approvals.list()) env.core.store.approvals.revoke(g.key, undefined, g.agent_id);
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
  }
});

test("an outside agent's read outside, a deletion or a read-only folder never gets the folder grant", async () => {
  const { thread, repo } = await session();
  await using away = tempDir("apx-away-");
  await using ref = tempDir("apx-ref-");
  await env.client.call("agents.update", { agent: "superagent", autonomy: "manual" });
  await env.client.call("projects.update", { project: thread.project_id ?? "", read_only_folders: [ref.path] });
  try {
    const read = await probe(thread.id, [{ kind: "read", path: path.join(away.path, "a.txt") }], { decision: "deny" });
    assert.equal(read.card?.approval_scopes?.includes("always") ?? false, false);
    const cat = await probe(thread.id, [{ kind: "execute", command: `cat ${sh(away.path)}/a.txt` }], {
      decision: "deny",
    });
    assert.equal(cat.card?.folders, undefined, "a command that only reads");
    // Asking before reading outside, a command copying from there is no folder to change for good.
    const cp = await probe(thread.id, [{ kind: "execute", command: `cp ${sh(away.path)}/a.txt ${sh(repo)}/b.txt` }], {
      decision: "deny",
    });
    assert.ok(cp.card, "the owner is asked");
    assert.equal(cp.card?.folders, undefined, "a copy from outside in Manual");
    const ro = await probe(thread.id, [{ kind: "edit", path: path.join(ref.path, "a.txt") }]);
    assert.equal(ro.said, "[false]");
    const rm = await probe(thread.id, [{ kind: "execute", command: `rm -rf ${sh(away.path)}/x` }], {
      decision: "deny",
    });
    assert.equal(rm.card?.folders, undefined);
  } finally {
    await env.client.call("projects.update", { project: thread.project_id ?? "", read_only_folders: [] });
    await env.client.call("agents.update", { agent: "superagent", autonomy: null });
    await removeDir(repo);
  }
});
