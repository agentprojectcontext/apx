import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const calls: Record<string, [string, object]> = {
  "write it": ["file_write", { path: "pages/btc.html", content: "<h1>BTC $1</h1>\n<p>$1</p>\n<p>$1</p>\n" }],
  "edit once": ["file_edit", { path: "pages/btc.html", old: "<h1>BTC $1</h1>", new: "<h1>BTC $&2</h1>" }],
  "edit twice": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3" }],
  "edit all": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3", all: true }],
  escape: ["file_write", { path: "../outside.txt", content: "no" }],
  absolute: ["file_write", { path: "/tmp/apx-absolute.txt", content: "no" }],
  git: ["file_write", { path: ".git/config", content: "no" }],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content)}`);
  const c = calls[said];
  return c ? callTool("f1", c[0], c[1]) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  // Writing is the owner's to allow; this agent may act without asking.
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const said = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

test("an agent writes and edits a file in the folder it works in, never outside it", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "files" });
  const file = path.join(env.home, "work", "pages", "btc.html");
  assert.match(await said(t.id, "write it"), /created .*pages\/btc\.html \(\d+ bytes\)/);
  assert.equal(fs.readFileSync(file, "utf8"), "<h1>BTC $1</h1>\n<p>$1</p>\n<p>$1</p>\n");
  assert.match(await said(t.id, "edit once"), /replaced 1 occurrence/);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "<h1>BTC $&2</h1>\n<p>$1</p>\n<p>$1</p>\n",
    "the new text is written as is",
  );
  assert.match(await said(t.id, "edit twice"), /found 2 times .*nothing changed/);
  assert.match(await said(t.id, "edit all"), /replaced 2 occurrences/);
  assert.equal(fs.readFileSync(file, "utf8"), "<h1>BTC $&2</h1>\n<p>$3</p>\n<p>$3</p>\n");
  for (const [ask, why] of [
    ["escape", /outside the folder/],
    ["absolute", /outside the folder/],
    ["git", /\.git folder is off limits/],
  ] as const)
    assert.match(await said(t.id, ask), why);
  assert.equal(fs.existsSync(path.join(env.home, "outside.txt")), false);
  assert.equal(fs.existsSync("/tmp/apx-absolute.txt"), false);
});
