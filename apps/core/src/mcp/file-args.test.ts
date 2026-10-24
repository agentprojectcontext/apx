import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { scratchDir } from "../tools/folders.ts";
import { type AgentFile, agentFiles, fillFileArgs, formOf, hasFileRefs, limitOf } from "./file-args.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const ID = "med_0123456789abcdef";

/** A file opener that hands out one PNG under any name, and records whether a path was asked for. */
const fake = (bytes = PNG) => {
  const asked: string[] = [];
  const open = (ref: string): AgentFile => ({
    name: "slide.png",
    mime: "image/png",
    bytes: bytes.length,
    read: () => bytes,
    path: () => {
      asked.push(ref);
      return `/tmp/apx-scratch/${ref}.png`;
    },
  });
  return { open, asked };
};

/** The shape of an upload tool on a remote server: one of a link, a path on its own disk or the bytes. */
const UPLOAD = {
  type: "object",
  properties: {
    url: { type: "string", description: "Public http(s) URL, preferred for video (up to 100 MB)" },
    path: { type: "string", description: "Local path, only when the server runs on the same machine" },
    base64: { type: "string", description: "Base64 file contents, images under 8 MB only" },
    mime_type: { type: "string" },
    file_name: { type: "string" },
    post_id: { type: "string" },
  },
};

test("a med_ id or apx-file: reference becomes base64 for a remote server, with its type and name filled in", () => {
  const { open } = fake();
  const out = fillFileArgs({ base64: ID, post_id: "01ABC" }, UPLOAD, { remote: true, open });
  assert.deepEqual(out, {
    base64: PNG.toString("base64"),
    post_id: "01ABC",
    mime_type: "image/png",
    file_name: "slide.png",
  });
  const own = fillFileArgs({ base64: "apx-file:out/slide.png", mime_type: "image/webp" }, UPLOAD, {
    remote: true,
    open,
  });
  assert.equal(own.base64, PNG.toString("base64"));
  assert.equal(own.mime_type, "image/webp", "what the agent set is kept");
});

test("a path or link field on a remote server is refused with the field that takes the file instead", () => {
  const { open } = fake();
  assert.throws(
    () => fillFileArgs({ path: ID }, UPLOAD, { remote: true, open }),
    /path is read by the server, which runs elsewhere.*give the file in base64 instead/,
  );
  assert.throws(
    () => fillFileArgs({ url: "apx-file:clip.mp4" }, UPLOAD, { remote: true, open }),
    /url takes a public link, and APX does not publish the owner's files: give the file in base64 instead/,
  );
});

test("a local server gets a real path; a kept file is copied out for it", () => {
  const { open, asked } = fake();
  const out = fillFileArgs({ path: ID }, UPLOAD, { remote: false, open });
  assert.equal(out.path, `/tmp/apx-scratch/${ID}.png`);
  assert.deepEqual(asked, [ID]);
  // A field that says it takes contents still gets them from a local server.
  assert.equal(fillFileArgs({ base64: ID }, UPLOAD, { remote: false, open }).base64, PNG.toString("base64"));
});

test("a file over what the field says it takes, or over its maxLength, is refused before anything is sent", () => {
  const { open } = fake(Buffer.alloc(9 * 1024 * 1024));
  assert.throws(
    () => fillFileArgs({ base64: ID }, UPLOAD, { remote: true, open }),
    /slide.png is 9.0 MB, over the 8.0 MB base64 takes/,
  );
  const tight = { type: "object", properties: { data: { type: "string", maxLength: 8 } } };
  assert.throws(() => fillFileArgs({ data: ID }, tight, { remote: true, open: fake().open }), /too big for data/);
});

test("references nested in arrays and objects are found; data URLs where the field asks for one", () => {
  const schema = {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: { image: { type: "string", description: "The image as a data URL" }, caption: {} },
        },
      },
    },
  };
  const out = fillFileArgs({ slides: [{ image: ID, caption: "one" }, { caption: "two" }] }, schema, {
    remote: true,
    open: fake().open,
  }) as { slides: Array<Record<string, unknown>> };
  assert.equal(out.slides[0]?.image, `data:image/png;base64,${PNG.toString("base64")}`);
  assert.deepEqual(out.slides[1], { caption: "two" });
});

test("what a field takes comes from its name, then its schema and description", () => {
  assert.equal(formOf("image_b64", undefined, true), "base64");
  assert.equal(formOf("content", { contentEncoding: "base64" }, false), "base64");
  assert.equal(formOf("source", { type: "string", format: "uri" }, true), "url");
  assert.equal(formOf("file_path", undefined, true), "path");
  assert.equal(formOf("data", { description: "base64, not a data URL" }, true), "base64");
  assert.equal(formOf("file", undefined, true), "base64");
  assert.equal(formOf("file", undefined, false), "path");
  assert.equal(limitOf({ description: "images under 8 MB, video up to 100 MB" }), 8 * 1024 * 1024);
  assert.equal(limitOf({ description: "anything" }), 20 * 1024 * 1024);
});

test("plain values pass through untouched", () => {
  assert.equal(hasFileRefs({ caption: "see med_ ids", n: 3, tags: ["a"] }), false);
  assert.equal(hasFileRefs({ list: [{ x: "apx-file:a.png" }] }), true);
  const args = { caption: "med_notanid", count: 2 };
  assert.deepEqual(fillFileArgs(args, UPLOAD, { remote: true, open: fake().open }), args);
});

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an agent hands on only its chat's kept files and paths in its own folders", async () => {
  const mine = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const up = (thread: string) =>
    env.client.call("media.upload", { name: "slide.png", mime: "image/png", data: PNG.toString("base64"), thread });
  const here = (await up(mine.id)).media;
  const there = (await up(other.id)).media;
  const thread = env.core.store.threads.get(mine.id);
  assert.ok(thread);
  const open = agentFiles(env.core.store, env.home, { ...thread, reach: "card" });

  const kept = open(here.id);
  assert.deepEqual([kept.name, kept.mime, kept.bytes], ["slide.png", "image/png", PNG.length]);
  assert.deepEqual(kept.read(), PNG);
  const copy = kept.path();
  assert.ok(copy.startsWith(scratchDir(env.core.store, env.home, thread)), "copied into the chat's temp folder");
  assert.deepEqual(fs.readFileSync(copy), PNG);
  assert.throws(() => open(there.id), /is not a file of this chat/);
  assert.throws(() => open("med_ffffffffffffffff"), /is not a file of this chat/);

  const work = path.join(env.home, "work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "cover.png"), PNG);
  const file = open("cover.png");
  assert.equal(file.mime, "image/png");
  assert.equal(file.path(), path.join(work, "cover.png"));
  assert.throws(() => open(path.join(env.home, "apx.db")), /refused/);
  assert.throws(() => open("missing.png"), /does not exist/);
});
