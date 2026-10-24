import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { mediaTools } from "./media.ts";
import { allowedTools } from "./policy.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const { tool = "open_document", ...args } = JSON.parse(said) as { tool?: string; path: string; format?: string };
  return callTool("document", tool, args);
});
let env: Awaited<ReturnType<typeof startCore>>;
let base: string;
before(async () => {
  env = await startCore({ llm });
  base = path.join(env.home, "work");
  fs.mkdirSync(base, { recursive: true });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function present(args: object) {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Documents" });
  await env.client.call("threads.send", { thread: thread.id, text: JSON.stringify(args) });
  const result = await env.settle(thread.id);
  assert.equal(result.runs[0]?.state, "completed");
  return { thread, message: result.messages.at(-1) };
}

test("file-capable agents can present a UTF-8 txt as Markdown without changing its name or contents", async () => {
  const agent = env.core.store.agents.get("roby");
  assert.ok(agent);
  assert.ok(
    allowedTools({ ...agent, tools: ["files"] }, mediaTools(env.core.store, env.home)).some(
      (t) => t.name === "open_document",
    ),
  );
  const source = "# Informe\n\n**Decisión**\n\n| Etapa | Estado |\n| --- | --- |\n| Diseño | Listo |\n";
  fs.writeFileSync(path.join(base, "Report.TXT"), source);
  const { thread, message } = await present({ path: "Report.TXT", title: "Project report" });
  const doc = message?.parts.find((p) => p.type === "file" && p.document);
  assert.ok(doc && doc.type === "file");
  assert.deepEqual(doc.document, { title: "Project report", format: "markdown", source: { path: "Report.TXT" } });
  const listed = await env.client.call("documents.list", { thread_id: thread.id });
  assert.deepEqual(listed.documents[0]?.source, { path: "Report.TXT" });
  assert.equal(doc.name, "Report.TXT");
  assert.equal(doc.mime, "text/plain");
  assert.equal(env.core.store.media.get(doc.media_id)?.thread_id, thread.id);
  assert.equal(fs.readFileSync(path.join(base, "Report.TXT"), "utf8"), source);
  const stored = await env.client.call("media.get", { id: doc.media_id });
  assert.equal(Buffer.from(stored.data, "base64").toString(), source);
  assert.ok(!message?.parts.some((p) => p.type === "surface"));
  assert.ok(String(llm.calls.at(-1)?.messages.at(-1)?.content).length < 300);
});

test("Markdown and plain text presentations stay explicit", async () => {
  for (const [name, format] of [
    ["Note.md", "markdown"],
    ["Note.markdown", "text"],
  ] as const) {
    fs.writeFileSync(path.join(base, name), "# Heading\n");
    const { message } = await present({ path: name, format });
    const doc = message?.parts.find((p) => p.type === "file");
    assert.ok(doc && doc.type === "file");
    assert.equal(doc.document?.format, format);
    assert.equal(doc.mime, "text/markdown");
  }
});

test("long file names keep the chat readable through the protocol", async () => {
  const name = `${"x".repeat(121)}.md`;
  fs.writeFileSync(path.join(base, name), "# Long name\n");
  const { thread, message } = await present({ path: name });
  const doc = message?.parts.find((p) => p.type === "file");
  assert.ok(doc);
  assert.equal(doc.name, name);
  assert.equal(doc.document?.title.length, 120);
  const loaded = await env.client.call("threads.get", { thread: thread.id });
  assert.deepEqual(loaded.messages.at(-1)?.parts, message?.parts);
});

test("ordinary file edits and downloads never become document presentations", async () => {
  const { message } = await present({ tool: "file_write", path: "Small.md", content: "One small change\n" });
  assert.ok(message?.parts.some((p) => p.type === "changes"));
  assert.ok(!message?.parts.some((p) => p.type === "file" && p.document));
  const sent = await present({ tool: "send_file", path: "Small.md" });
  const file = sent.message?.parts.find((p) => p.type === "file");
  assert.ok(file);
  assert.equal(file.document, undefined);
});

test("documents reject escapes, git metadata, symlinks outside work, binaries, invalid UTF-8 and oversized files", async () => {
  fs.writeFileSync(path.join(env.home, "private.txt"), "Private");
  fs.symlinkSync(path.join(env.home, "private.txt"), path.join(base, "escape.txt"));
  fs.mkdirSync(path.join(base, ".git"));
  fs.writeFileSync(path.join(base, ".git", "note.txt"), "Private");
  fs.symlinkSync(path.join(base, ".git"), path.join(base, "metadata"));
  fs.writeFileSync(path.join(base, "binary.txt"), Buffer.from([65, 0, 66]));
  fs.writeFileSync(path.join(base, "invalid.txt"), Buffer.from([0xc0, 0xaf]));
  fs.writeFileSync(path.join(base, "huge.md"), Buffer.alloc(DOCUMENT_MAX_BYTES + 1, 65));
  fs.writeFileSync(path.join(base, "script.js"), "alert('no');");
  for (const file of [
    "../private.txt",
    path.join(env.home, "private.txt"),
    "escape.txt",
    ".git/note.txt",
    "metadata/note.txt",
    "binary.txt",
    "invalid.txt",
    "huge.md",
    "script.js",
    "missing.md",
    ".",
  ]) {
    const { message } = await present({ path: file });
    assert.ok(!message?.parts.some((p) => p.type === "file"));
    assert.equal(message?.parts.find((p) => p.type === "tool")?.status, "error");
  }
  await assert.rejects(
    env.client.call("media.attach", { path: "Report.TXT", document: true }),
    /only the running agent/,
  );
});

test("a document survives source changes, deletion and core restart", async () => {
  fs.writeFileSync(path.join(base, "Durable.md"), "# Original\n");
  const { thread, message } = await present({ path: "Durable.md" });
  const doc = message?.parts.find((p) => p.type === "file");
  assert.ok(doc);
  fs.writeFileSync(path.join(base, "Durable.md"), "# Revised\n");
  const newer = await present({ path: "Durable.md" });
  const changed = newer.message?.parts.find((p) => p.type === "file");
  assert.ok(changed);
  assert.notEqual(changed.media_id, doc.media_id);
  fs.unlinkSync(path.join(base, "Durable.md"));
  await env.core.close();
  env = await startCore({ llm, home: env.home });
  const loaded = await env.client.call("threads.get", { thread: thread.id });
  assert.deepEqual(loaded.messages.at(-1)?.parts, message?.parts);
  const stored = await env.client.call("media.get", { id: doc.media_id });
  assert.equal(Buffer.from(stored.data, "base64").toString(), "# Original\n");
  const revision = await env.client.call("media.get", { id: changed.media_id });
  assert.equal(Buffer.from(revision.data, "base64").toString(), "# Revised\n");
});
