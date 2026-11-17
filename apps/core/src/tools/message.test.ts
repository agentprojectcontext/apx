import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { namesApxHome, scratchDir, workDir } from "./folders.ts";
import { messageTools } from "./message.ts";
import type { ToolContext } from "./types.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let outside: Awaited<ReturnType<typeof tempDir>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  outside = await tempDir("apx-channel-files-");
  env.core.store.persons.create({ name: "Acme contact", role: "contact" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await outside.remove();
});

async function send(file: string, threadId = "home", toolName = "channel_post") {
  const stored = env.core.store.threads.get(threadId);
  assert.ok(stored);
  const calls: Array<{ method: string; files: string[] }> = [];
  const ctx = {
    thread: { ...stored, reach: "read" },
    call: async (method: string, args: { files: string[] }) => {
      calls.push({ method, files: args.files });
      return { channel: "Discord", recent: [], delivery: { state: "sent" } };
    },
  } as unknown as ToolContext;
  const tool = messageTools(env.core.store, env.home).find((tool) => tool.name === toolName);
  assert.ok(tool);
  const result = await tool.run({ room: "general", to: "Acme contact", text: "Video", files: [file] }, ctx);
  return { result, calls };
}

function write(file: string, bytes: Buffer = Buffer.from([0, 255, 13, 10, 42])) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes;
}

test("Home can send its own scratch MP4 to a room or contact with an exact media snapshot", async () => {
  const thread = env.core.store.threads.get("home");
  assert.ok(thread);
  const file = path.join(scratchDir(env.core.store, env.home, thread), "video.mp4");
  const bytes = write(file);
  for (const name of ["channel_post", "message_contact"]) {
    const { result, calls } = await send(file, "home", name);
    assert.match(String(result), /sent to .* with 1 file/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, name === "channel_post" ? "channels.post" : "channels.message");
    const id = calls[0]?.files[0];
    assert.ok(id);
    const media = env.core.store.media.get(id);
    assert.ok(media);
    assert.equal(media.thread_id, "home");
    assert.equal(media.mime, "video/mp4");
    assert.equal(media.prompt, "video.mp4");
    assert.deepEqual(fs.readFileSync(media.path), bytes);
  }
});

test("delegated chats share the parent's scratch and work-folder attachments still work", async () => {
  const store = env.core.store;
  const child = store.threads.create({ kind: "a2a", parent_id: "home", title: "Helper", agent_ids: ["superagent"] });
  const shared = path.join(scratchDir(store, env.home, child), "shared.mp4");
  write(shared);
  assert.match(String((await send(shared, child.id)).result), /sent to/);
  const file = path.join(workDir(store, env.home, child), "work.mp4");
  write(file);
  assert.match(String((await send(file, child.id)).result), /sent to/);
});

test("scratch cannot send other chats, arbitrary readable files, traversal or symlink escapes", async () => {
  const store = env.core.store;
  const thread = store.threads.get("home");
  assert.ok(thread);
  const scratch = scratchDir(store, env.home, thread);
  const other = store.threads.create({ kind: "loose", title: "Other", agent_ids: ["superagent"] });
  const foreign = path.join(scratchDir(store, env.home, other), "foreign.mp4");
  const arbitrary = path.join(outside.path, "private.mp4");
  const internal = path.join(env.home, "private.mp4");
  for (const file of [foreign, arbitrary, internal]) write(file);
  const escaped = path.join(scratch, "escaped.mp4");
  const secret = path.join(scratch, "secret.mp4");
  fs.symlinkSync(arbitrary, escaped);
  fs.symlinkSync(internal, secret);
  const metadata = path.join(scratch, ".git", "config");
  write(metadata);
  const nested = path.join(scratch, "nested");
  fs.mkdirSync(nested);
  fs.symlinkSync(nested, path.join(outside.path, "alias"), process.platform === "win32" ? "junction" : "dir");
  const mixedTraversal = `${outside.path}${path.sep}alias${path.sep}..${path.sep}private.mp4`;
  const gitAlias = path.join(scratch, "metadata");
  fs.symlinkSync(path.dirname(metadata), gitAlias, process.platform === "win32" ? "junction" : "dir");
  for (const file of [
    foreign,
    arbitrary,
    mixedTraversal,
    internal,
    escaped,
    secret,
    metadata,
    path.join(gitAlias, "config"),
    path.join(scratch, "..", other.id, "foreign.mp4"),
  ]) {
    for (const name of ["channel_post", "message_contact"]) {
      const { result, calls } = await send(file, "home", name);
      assert.match(String(result), /not posted:|not sent:/, file);
      assert.deepEqual(calls, [], file);
    }
  }
});

test("scratch still refuses missing files, directories and oversized attachments; internal Home remains protected", async () => {
  const thread = env.core.store.threads.get("home");
  assert.ok(thread);
  const scratch = scratchDir(env.core.store, env.home, thread);
  const huge = path.join(scratch, "huge.mp4");
  const fd = fs.openSync(huge, "w");
  fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  for (const file of [path.join(scratch, "missing.mp4"), scratch, huge]) {
    const { result, calls } = await send(file);
    assert.match(String(result), /not posted:/);
    assert.deepEqual(calls, []);
  }
  assert.equal(namesApxHome(`cp video.mp4 "${path.join(env.home, "work", "video.mp4")}"`, env.home, undefined), true);
});
