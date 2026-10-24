import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir } from "../testkit/platform.ts";
import { scratchRoot } from "../tools/folders.ts";

const llm = scriptedLlm((_req, { said }) =>
  said.includes("how full")
    ? { ...say("ok"), model: "pa/claude-sonnet-4", usage: { input: 38_000, output: 20 } }
    : say("ok"),
);
let env: Awaited<ReturnType<typeof startCore>>;
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
// The smallest PNG there is (1×1).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a text file is read into the turn as outside content and shown with the message", async () => {
  const { media } = await env.client.call("media.upload", {
    name: "notes.md",
    mime: "text/markdown",
    data: b64("# Plan\nShip on Friday."),
  });
  assert.equal(media.kind, "file");
  const r = await env.client.call("threads.send", { thread: "home", text: "summarize this", attachments: [media.id] });
  await env.settle("home");
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /summarize this/);
  assert.match(input, /<attachment name="notes.md" mime="text\/markdown"[^>]*>[\s\S]*Ship on Friday\./);
  const parts = r.message.parts;
  assert.deepEqual(parts[1], { type: "file", media_id: media.id, name: "notes.md", mime: "text/markdown", bytes: 22 });
});

test("an image goes to the model as a reference, and routes as an image turn", async () => {
  const { media } = await env.client.call("media.upload", { name: "cat.png", mime: "image/png", data: PNG });
  assert.equal(media.kind, "image");
  await env.client.call("threads.send", { thread: "home", text: "what is it?", attachments: [media.id] });
  await env.settle("home");
  const item = llm.calls.at(-1)?.messages.at(-1) as { images?: Array<{ media_id: string }>; content: string };
  assert.deepEqual(
    item.images?.map((i) => i.media_id),
    [media.id],
  );
  assert.match(item.content, /\[image attached: cat\.png/);
});

test("uploads refuse binary as text and an empty file; any other type is kept as a file", async () => {
  await assert.rejects(
    env.client.call("media.upload", { name: "a.txt", mime: "text/plain", data: b64(Buffer.from([0x61, 0, 0x62])) }),
    /not a text file/,
  );
  const { media: exe } = await env.client.call("media.upload", {
    name: "a.exe",
    mime: "application/x-msdownload",
    data: b64("MZ"),
  });
  assert.equal(exe.kind, "file");
  assert.equal((await env.client.call("media.get", { id: exe.id })).mime, "application/x-msdownload");
  await assert.rejects(env.client.call("media.upload", { name: "e.txt", mime: "text/plain", data: "" }), /empty/);
  await assert.rejects(
    env.client.call("threads.send", { thread: "home", text: "x", attachments: ["med_nope"] }),
    /no attachment/,
  );
});

test("a chat's own model is kept on the thread and checked", async () => {
  const r = await env.client.call("threads.model", {
    thread: "home",
    model_choice: { model: "fake/fake-2", router: false },
  });
  assert.equal(r.model_choice?.model, "fake/fake-2");
  assert.equal((await env.client.call("threads.get", { thread: "home" })).thread.model_choice?.model, "fake/fake-2");
  await assert.rejects(
    env.client.call("threads.model", { thread: "home", model_choice: { model: "nowhere/x", router: false } }),
  );
  await env.client.call("threads.model", { thread: "home", model_choice: null });
  assert.equal((await env.client.call("threads.get", { thread: "home" })).thread.model_choice, undefined);
});

test("dictation without a transcription engine says how to set one up", async () => {
  await assert.rejects(
    env.client.call("media.transcribe", { data: b64("x"), mime: "audio/webm" }),
    /Settings › Voices/,
  );
});

test("a run says how full the chat is: the last call's input, against the model's window", async () => {
  const r = await env.client.call("threads.send", { thread: "home", text: "how full is it?" });
  await env.settle("home");
  const { runs } = await env.client.call("threads.get", { thread: "home" });
  const run = runs.find((x) => x.id === r.run?.id);
  assert.deepEqual(run?.usage, { input: 38_000, output: 20, context: 38_000, window: 200_000 });
});

test("an image of a few megabytes uploads over HTTP; over 5 MB it is refused with the reason", async () => {
  const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(3 * 1024 * 1024, 7)]);
  const { media } = await env.client.call("media.upload", {
    name: "photo.png",
    mime: "image/png",
    data: big.toString("base64"),
  });
  assert.equal(media.bytes, big.length);
  await assert.rejects(
    env.client.call("media.upload", {
      name: "huge.png",
      mime: "image/png",
      data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
    }),
    /huge\.png is over 5 MB/,
  );
});

test("only this chat's uploads attach: not another chat's, not media APX made, not a mislabeled image", async () => {
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const { media } = await env.client.call("media.upload", {
    name: "a.txt",
    mime: "text/plain",
    data: b64("hi"),
    thread: other.id,
  });
  await assert.rejects(
    env.client.call("threads.send", { thread: "home", text: "x", attachments: [media.id] }),
    /no attachment/,
  );
  await assert.rejects(
    env.client.call("media.upload", { name: "fake.png", mime: "image/png", data: b64("not a png") }),
    /fake\.png is not a PNG image/,
  );
});

test("a PDF is available byte-for-byte in the chat's temp folder, with a safe name, never in the project", async () => {
  const pdf = Buffer.from("%PDF-1.4\nreceipt\n%%EOF");
  const { media } = await env.client.call("media.upload", {
    name: "../../receipt.pdf",
    mime: "application/pdf",
    data: b64(pdf),
    thread: "home",
  });
  await env.client.call("threads.send", { thread: "home", text: "read receipt", attachments: [media.id] });
  await env.settle("home");
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  const at = /File in your temp folder: ([^ ]+)\. Use/.exec(input)?.[1];
  assert.ok(at);
  assert.equal(path.relative(path.join(scratchRoot(env.home), "home"), path.dirname(path.dirname(at))), "attachments");
  assert.match(at, /[\\/]upload-[^\\/]+[\\/]receipt\.pdf$/);
  assert.deepEqual(fs.readFileSync(at), pdf);
  assert.equal(fs.existsSync(path.join(env.home, "work", ".apx-attachments")), false);
});

test("an attachment destination symlink cannot write outside the temp folder", async (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "apx-attachment-outside-"));
  const local = await startCore({ llm: scriptedLlm(() => say("ok")) });
  t.after(async () => {
    await local.core.close();
    await local.cleanup();
    await removeDir(outside);
  });
  fs.mkdirSync(path.join(scratchRoot(local.home), "home"), { recursive: true });
  fs.symlinkSync(outside, path.join(scratchRoot(local.home), "home", "attachments"), "dir");
  const { media } = await local.client.call("media.upload", {
    name: "receipt.pdf",
    mime: "application/pdf",
    data: b64("%PDF-1.4"),
  });
  await local.client.call("threads.send", { thread: "home", text: "read", attachments: [media.id] });
  await local.settle("home");
  assert.deepEqual(fs.readdirSync(outside), []);
});
