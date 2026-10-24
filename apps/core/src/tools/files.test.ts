import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fileTools } from "./files.ts";
import { scratchRoot } from "./folders.ts";
import { defineTool, type Tool } from "./types.ts";

const calls: Record<string, [string, object]> = {
  "write it": ["file_write", { path: "pages/btc.html", content: "<h1>BTC $1</h1>\n<p>$1</p>\n<p>$1</p>\n" }],
  "edit once": ["file_edit", { path: "pages/btc.html", old: "<h1>BTC $1</h1>", new: "<h1>BTC $&2</h1>" }],
  "edit twice": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3" }],
  "edit all": ["file_edit", { path: "pages/btc.html", old: "$1", new: "$3", all: true }],
  "write new": ["file_write", { path: "pages/new.html", content: "<p>$1</p>\n<p>$1</p>\n" }],
  "edit new": ["file_edit", { path: "pages/new.html", old: "$1", new: "$2", all: true }],
  escape: ["file_write", { path: "../outside.txt", content: "no" }],
  absolute: ["file_write", { path: "/apx-absolute.txt", content: "no" }],
  git: ["file_write", { path: ".git/config", content: "no" }],
  "read page": ["file_read", { path: "pages/btc.html", offset: 2, limit: 1 }],
  "read binary": ["file_read", { path: "pages/blob.bin" }],
  "read picture": ["file_read", { path: "pages/dot.png" }],
  "read memo": ["file_read", { path: "pages/memo.mp3" }],
  "read outside": ["file_read", { path: "../secrets.index.json" }],
  "edit in tree": ["file_edit", { path: "docs/spec.md", old: "base", new: "tree", cwd: ".worktrees/issue-1" }],
  "write in tree": ["file_write", { path: "docs/new.md", content: "new\n", cwd: ".worktrees/issue-1" }],
  "read in tree": ["file_read", { path: "docs/spec.md", cwd: ".worktrees/issue-1" }],
  "tree escape": ["file_write", { path: "../../../outside.txt", content: "no", cwd: ".worktrees/issue-1" }],
  "cwd outside": ["file_read", { path: "secrets.index.json", cwd: ".." }],
  "cwd missing": ["file_write", { path: "a.md", content: "no", cwd: "no-such-tree" }],
  "cwd git": ["file_write", { path: "config", content: "no", cwd: ".git" }],
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
  await env.cleanup();
});

const said = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

test("an agent writes and edits a file in the folder it works in, never outside it", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "files" });
  const file = path.join(env.home, "work", "pages", "btc.html");
  assert.match(await said(t.id, "write it"), /created .*pages[\\/]btc\.html \(\d+ bytes\)/);
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
  // Fenced in by its own rule it is refused outside its folders; on total it writes anywhere but APX's home (DECISIONS.md#d-102).
  await env.client.call("agents.update", { agent: "roby", autonomy: "auto", rules: { outside: "off" } });
  try {
    for (const [ask, why] of [
      ["escape", /APX's own folder/],
      ["absolute", /outside the folder/],
      ["git", /\.git folder is off limits/],
    ] as const)
      assert.match(await said(t.id, ask), why);
  } finally {
    await env.client.call("agents.update", { agent: "roby", autonomy: "total", rules: null });
  }
  assert.equal(fs.existsSync(path.join(env.home, "outside.txt")), false);
  assert.equal(fs.existsSync("/apx-absolute.txt"), false);
});

test("file tools take shell's cwd: a relative path in a worktree lands in it, never in the root checkout", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "worktree" });
  const root = path.join(env.home, "work");
  const tree = path.join(root, ".worktrees", "issue-1");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(tree, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "spec.md"), "root\n");
  fs.writeFileSync(path.join(tree, "docs", "spec.md"), "base\n");
  assert.match(
    await said(t.id, "edit in tree"),
    /replaced 1 occurrence in .*\.worktrees[\\/]issue-1[\\/]docs[\\/]spec\.md/,
  );
  assert.match(await said(t.id, "write in tree"), /created .*\.worktrees[\\/]issue-1[\\/]docs[\\/]new\.md/);
  assert.match(await said(t.id, "read in tree"), /lines 1-2 of 2[\s\S]*tree/);
  assert.equal(fs.readFileSync(path.join(tree, "docs", "spec.md"), "utf8"), "tree\n");
  assert.equal(fs.readFileSync(path.join(root, "docs", "spec.md"), "utf8"), "root\n");
  assert.equal(fs.existsSync(path.join(root, "docs", "new.md")), false);
  for (const [ask, why] of [
    ["tree escape", /APX's own folder/],
    ["cwd outside", /APX's own folder/],
    ["cwd missing", /^(?!.*refused).*no-such-tree does not exist/s],
    ["cwd git", /\.git folder is off limits/],
  ] as const)
    assert.match(await said(t.id, ask), why);
  assert.equal(fs.existsSync(path.join(env.home, "outside.txt")), false);
});

test("APC files named through cwd still wait for the owner; the temp folder through cwd does not", () => {
  const write = parallelFiles.find((t) => t.name === "file_write");
  assert.ok(write);
  assert.equal(write.confirm({ path: "AGENTS.md", content: "", cwd: ".worktrees/issue-1" }), "always");
  assert.equal(write.confirm({ path: "agents/a.md", content: "", cwd: ".apc" }), "always");
  assert.equal(write.confirm({ path: "docs/a.md", content: "", cwd: ".worktrees/issue-1" }), "untrusted");
  // A worktree an agent keeps under .apc is a checkout of the code, not the project's APC definitions.
  assert.equal(write.confirm({ path: ".apc/worktree/issue-1/src/a.ts", content: "" }), "untrusted");
  assert.equal(write.confirm({ path: "src/a.ts", content: "", cwd: ".apc/worktrees/issue-1" }), "untrusted");
  assert.equal(write.confirm({ path: ".apc/worktree/issue-1/AGENTS.md", content: "" }), "always");
  assert.equal(write.confirm({ path: ".apc/agents/a.md", content: "" }), "always");
  const scratch = path.join(scratchRoot(env.home), "some-chat");
  assert.equal(write.confirm({ path: "a.md", content: "", cwd: scratch }), "never");
});

test("a file write waiting for the owner shows the patch it would make, and nothing for a call that would fail", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "preview" });
  const ctx = { thread: env.core.store.threads.get(t.id), agent: env.core.store.agents.get("roby") } as Parameters<
    NonNullable<Tool["preview"]>
  >[1];
  const tool = (name: string) => parallelFiles.find((x) => x.name === name);
  fs.writeFileSync(path.join(env.home, "work", "preview.md"), "one\ntwo\nthree\n");
  const edit = await tool("file_edit")?.preview?.({ path: "preview.md", old: "two", new: "TWO" }, ctx);
  assert.equal(edit?.path, "preview.md");
  assert.equal(edit?.status, "M");
  assert.deepEqual([edit?.added, edit?.removed], [1, 1]);
  assert.match(edit?.diff ?? "", /^@@ -1,3 \+1,3 @@\n one\n-two\n\+TWO\n three/);
  assert.equal(fs.readFileSync(path.join(env.home, "work", "preview.md"), "utf8"), "one\ntwo\nthree\n");
  const write = await tool("file_write")?.preview?.({ path: "fresh.md", content: "hi\n" }, ctx);
  assert.deepEqual([write?.status, write?.added, write?.removed], ["A", 1, 0]);
  assert.equal(await tool("file_edit")?.preview?.({ path: "preview.md", old: "missing", new: "x" }, ctx), undefined);
  assert.equal(await tool("file_write")?.preview?.({ path: "../outside.md", content: "x" }, ctx), undefined);
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
  assert.match(await said(t.id, "read outside"), /APX's own folder/);
});

test("an agent that reads an image file sees it", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "picture" });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  fs.writeFileSync(path.join(env.home, "work", "pages", "dot.png"), Buffer.from(png, "base64"));
  assert.match(await said(t.id, "read picture"), /the picture shows \(from file_read\)/);
  const messages = llm.calls.at(-1)?.messages ?? [];
  assert.match(
    String(messages.findLast((m) => m.role === "tool")?.content),
    /pages\/dot\.png: an image \(image\/png, \d+ bytes\)/,
  );
  assert.equal(messages.filter((m) => m.role === "user" && m.images?.length).length, 1);
});

test("an agent that reads an audio file gets its transcript, as data; only the owner transcribes anything else", async () => {
  const ears = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "buy milk on the way home" }));
  });
  await new Promise<void>((r) => ears.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(ears.address() as AddressInfo).port}`;
    await env.client.call("services.set", {
      id: "ears",
      service: {
        kind: "transcription",
        dialect: "whisper-local",
        label: "Ears",
        base_url: url,
        enabled: true,
        needs_key: false,
      },
    });
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "memo" });
    fs.writeFileSync(path.join(env.home, "work", "pages", "memo.mp3"), Buffer.from("ID3-not-really-mp3"));
    assert.match(
      await said(t.id, "read memo"),
      /pages\/memo\.mp3: audio \(audio\/mpeg\), transcribed:\n<transcript path="pages\/memo\.mp3" trust="untrusted">\nbuy milk on the way home\n<\/transcript>/,
    );
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(
      agent.call("media.transcribe", { data: Buffer.from("x").toString("base64"), mime: "audio/webm" }),
      /only audio attached in its own chat/,
    );
  } finally {
    await new Promise<void>((r) => ears.close(() => r()));
  }
});
