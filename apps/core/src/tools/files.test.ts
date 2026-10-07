import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fileTools } from "./files.ts";
import { defineTool, type Tool } from "./types.ts";

const calls: Record<string, [string, object]> = {
  "write it": ["file_write", { path: "pages/btc.html", content: "<h1>BTC $1</h1>\n<p>$1</p>\n<p>$1</p>\n" }],
  "edit once": ["file_edit", { path: "pages/btc.html", old: "<h1>BTC $1</h1>", new: "<h1>BTC $&2</h1>" }],
  "edit twice": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3" }],
  "edit all": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3", all: true }],
  "write new": ["file_write", { path: "pages/new.html", content: "<p>$1</p>\n<p>$1</p>\n" }],
  "edit new": ["file_edit", { path: "pages/new.html", old: "$1", new: "$2", all: true }],
  escape: ["file_write", { path: "../outside.txt", content: "no" }],
  absolute: ["file_write", { path: "/tmp/apx-absolute.txt", content: "no" }],
  git: ["file_write", { path: ".git/config", content: "no" }],
  "read page": ["file_read", { path: "pages/btc.html", offset: 2, limit: 1 }],
  "read binary": ["file_read", { path: "pages/blob.bin" }],
  "read outside": ["file_read", { path: "../secrets.index.json" }],
  parallel: ["file_parallel", {}],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content)}`);
  const c = calls[said];
  return c ? callTool("f1", c[0], c[1]) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let parallelFiles: Tool[];
before(async () => {
  env = await startCore({
    llm,
    extraTools: [
      defineTool({
        name: "file_parallel",
        description: "Exercise concurrent file calls",
        args: z.object({}),
        effect: "local",
        deadlineMs: 10_000,
        title: () => "Parallel writes",
        async run(_args, ctx) {
          const write = parallelFiles.find((t) => t.name === "file_write");
          assert.ok(write);
          await Promise.all([
            write.run({ path: "parallel.md", content: "First\n" }, ctx),
            write.run({ path: "parallel.md", content: "Second\n" }, ctx),
            ...Array.from({ length: 5 }, (_, i) =>
              write.run({ path: `large-${i}.md`, content: "Added\n".repeat(20_000) }, ctx),
            ),
          ]);
          return "Done";
        },
      }),
    ],
  });
  parallelFiles = fileTools(env.core.store, env.home);
  // Writing is the owner's to allow; this agent may act without asking.
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
});

test("parallel writes preserve final disk order and share the recorded patch budget", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await said(t.id, "parallel");
  const messages = (await env.client.call("threads.get", { thread: t.id })).messages;
  const part = messages.at(-1)?.parts.find((p) => p.type === "changes");
  assert.ok(part && part.type === "changes");
  assert.equal(part.files.length, 6);
  const parallel = part.files.find((f) => f.path === "parallel.md");
  assert.ok(parallel?.diff);
  assert.equal(fs.readFileSync(path.join(env.home, "work", "parallel.md"), "utf8"), "Second\n");
  assert.match(parallel.diff, /^\+Second$/m);
  assert.doesNotMatch(parallel.diff, /First/);
  assert.equal(parallel.added, 1);
  assert.equal(parallel.removed, 0);
  assert.ok(part.files.every((f) => (f.diff?.length ?? 0) <= 64_000));
  assert.ok(part.files.reduce((n, f) => n + (f.diff?.length ?? 0), 0) <= 200_000);
  assert.ok(part.files.some((f) => f.truncated));
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

test("the files an agent writes in a turn show in its answer, with the lines added and removed", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "card" });
  await env.client.call("threads.send", { thread: t.id, text: "write new" });
  let { messages } = await env.settle(t.id);
  const card = () => messages.at(-1)?.parts.find((p) => p.type === "changes");
  assert.deepEqual(card(), {
    type: "changes",
    cwd: path.join(env.home, "work"),
    edits: true,
    files: [
      {
        path: "pages/new.html",
        status: "A",
        added: 2,
        removed: 0,
        diff: "@@ -0,0 +1,2 @@\n+<p>$1</p>\n+<p>$1</p>\n",
        truncated: false,
      },
    ],
  });
  await env.client.call("threads.send", { thread: t.id, text: "edit new" });
  ({ messages } = await env.settle(t.id));
  const edit = card();
  assert.deepEqual(edit?.type === "changes" && edit.files, [
    {
      path: "pages/new.html",
      status: "M",
      added: 2,
      removed: 2,
      diff: "@@ -1,2 +1,2 @@\n-<p>$1</p>\n-<p>$1</p>\n+<p>$2</p>\n+<p>$2</p>\n",
      truncated: false,
    },
  ]);
});

test("an agent reads a text file by lines, as data; a binary one or one outside the folder is not read", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "read" });
  fs.writeFileSync(path.join(env.home, "work", "pages", "btc.html"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(env.home, "work", "pages", "blob.bin"), Buffer.from([0, 1, 2, 3]));
  const page = await said(t.id, "read page");
  assert.match(page, /pages\/btc\.html: lines 2-2 of 4 \(more: offset=3\)/);
  assert.match(page, /<file path="pages\/btc\.html" trust="untrusted">\ntwo\n<\/file>/);
  assert.match(await said(t.id, "read binary"), /is not a text file/);
  assert.match(await said(t.id, "read outside"), /outside the folder/);
});
