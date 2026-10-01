import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { ftsQuery, looksSecret } from "../domain/memories.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 300)}`);
  if (said.includes("note the deploy day"))
    return callTool("r1", "remember", { text: "Deploys to Northwind happen on Thursdays." });
  if (said.includes("forget the owner note")) return callTool("f1", "forget", { id: String(said.split(" ").at(-1)) });
  if (said.includes("search memory")) return callTool("s1", "recall", { query: "cafe" });
  if (said.includes("leak a key"))
    return callTool("k1", "remember", { text: "the api key is sk-abcdefghijklmnop1234" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-mem-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  fs.mkdirSync(path.join(repo, ".apc"));
  fs.writeFileSync(path.join(repo, ".apc", "memory.md"), "## Notes\n- The staging server is called kestrel.\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

const lastInput = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

test("search ignores accents and case, and free text never reaches FTS as syntax", () => {
  assert.equal(ftsQuery("the and of"), undefined);
  assert.match(ftsQuery('café" OR x NEAR(') ?? "", /^"cafe"/);
  assert.ok(looksSecret("token: ghp_abcdefghijklmnopqrstu"));
  assert.ok(!looksSecret("The owner prefers short answers."));
});

test("an agent's first turn gets the owner's standing notes; later turns only new matches", async () => {
  await env.client.call("memory.add", { text: "The owner prefers short answers in Spanish.", scope: "global" });
  await env.client.call("memory.add", { text: "Kestrel deploys need a green CI.", scope: "project", project });
  await env.client.call("memory.add", { text: "Vera keeps her drafts in Notion.", scope: "agent", agent: "vera" });
  await env.client.call("memory.add", { text: "Best café near the office is on 5th.", scope: "global" });

  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "hello there" });
  await env.settle(t.id);
  const first = lastInput();
  assert.match(first, /\[memory: notes saved earlier\][\s\S]*short answers/);
  assert.doesNotMatch(first, /Notion/, "another agent's notebook stays private");
  const system = String(llm.calls.at(-1)?.messages[0]?.content);
  assert.match(system, /\.apc\/memory\.md\)\n\n## Notes\n- The staging server is called kestrel\./);

  await env.client.call("threads.send", { thread: t.id, text: "how do kestrel deploys work?" });
  await env.settle(t.id);
  const second = lastInput();
  assert.match(second, /green CI/);
  assert.doesNotMatch(second, /short answers/, "a note already shown in this thread is not repeated");

  await env.client.call("threads.send", { thread: t.id, text: "and the kestrel deploys again?" });
  await env.settle(t.id);
  assert.doesNotMatch(lastInput(), /\[memory/);
});

test("remember saves for the thread's project; recall finds accent-free; secrets are refused", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "note the deploy day" });
  await env.settle(t.id);
  const { memories } = await env.client.call("memory.list", { query: "thursdays deploys" });
  const saved = memories.find((m) => m.text.includes("Thursdays"));
  assert.equal(saved?.scope, "project");
  assert.equal(saved?.project_id, project);
  assert.equal(saved?.source, "agent");
  assert.equal(saved?.author_agent, "roby");

  await env.client.call("threads.send", { thread: t.id, text: "search memory" });
  await env.settle(t.id);
  assert.match(lastInput(), /café near the office/);

  await env.client.call("threads.send", { thread: t.id, text: "leak a key" });
  await env.settle(t.id);
  assert.match(lastInput(), /never keeps credentials/);
  const after = await env.client.call("memory.list", { query: "api key" });
  assert.equal(after.memories.length, 0);
});

test("an agent cannot remove the owner's notes nor see another agent's", async () => {
  const owner = await env.client.call("memory.add", { text: "Invoices go out on the 1st.", scope: "global" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: `forget the owner note ${owner.id}` });
  await env.settle(t.id);
  assert.match(lastInput(), /only remove notes agents wrote/);
  assert.ok((await env.client.call("memory.list", {})).memories.some((m) => m.id === owner.id));

  await assert.rejects(
    env.client.call("memory.add", { text: "x", scope: "project" }),
    (e: unknown) => e instanceof ApxError && /needs a project/.test(e.message),
  );
});
