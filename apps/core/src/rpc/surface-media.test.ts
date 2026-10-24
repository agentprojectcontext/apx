import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

/** A PNG signature and a few bytes: what an upload checks an image by. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("a widget loads its project's media it names, and nothing else", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-surface-media-")));
  const other = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-surface-media-other-")));
  try {
    fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
    fs.writeFileSync(path.join(other, "AGENTS.md"), "# Northwind\n");
    fs.mkdirSync(path.join(repo, "clips"));
    fs.writeFileSync(path.join(repo, "clips", "reel.mp4"), "fake mp4 bytes");
    fs.writeFileSync(path.join(repo, "cover.png"), "fake png bytes");
    fs.writeFileSync(path.join(repo, "notes.md"), "private notes");
    fs.writeFileSync(path.join(repo, "brief.pdf"), "%PDF");
    const acme = (await env.client.call("projects.register", { path: repo })).project.id;
    const northwind = (await env.client.call("projects.register", { path: other })).project.id;
    const { store } = env.core;
    const chat = store.threads.create({ kind: "agent", title: "Reels", agent_ids: [], project_id: acme });
    const elsewhere = store.threads.create({ kind: "agent", title: "Other", agent_ids: [], project_id: northwind });
    const upload = (thread: string) =>
      env.client.call("media.upload", { name: "take.png", mime: "image/png", data: PNG.toString("base64"), thread });
    const own = (await upload(chat.id)).media.id;
    const foreign = (await upload(elsewhere.id)).media.id;

    const html = `<video data-apx-src="clips/reel.mp4"></video><img data-apx-src="cover.png">
      <img data-apx-src="media:${own}"><img data-apx-src="media:${foreign}"><a href="notes.md">notes.md</a>
      <img data-apx-src="brief.pdf"><img data-apx-src="../outside.png"><img data-apx-src="missing.png">`;
    const w = await env.client.call("surfaces.show", { name: "reel", title: "Reel", html, thread: chat.id });
    const media = (ref: string) => env.client.call("surfaces.media", { surface: w.id, ref });

    const reel = await media("clips/reel.mp4");
    assert.equal(reel.mime, "video/mp4");
    assert.equal(Buffer.from(reel.data, "base64").toString(), "fake mp4 bytes");
    assert.equal((await media("cover.png")).mime, "image/png");
    assert.deepEqual(Buffer.from((await media(`media:${own}`)).data, "base64"), PNG);

    // Another project's stored file, text files, PDFs, paths out of the folder and refs not in the widget are refused.
    await assert.rejects(media(`media:${foreign}`), /not found/);
    await assert.rejects(media("notes.md"), /not an image, video or audio/);
    await assert.rejects(media("brief.pdf"), /not an image, video or audio/);
    await assert.rejects(media("../outside.png"), /outside the folder/);
    await assert.rejects(media("missing.png"), /not found/);
    await assert.rejects(media("AGENTS.md"), /not in the widget/);

    // It is the panel's call: an agent reads files with its own tools, under its own checks.
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("surfaces.media", { surface: w.id, ref: "cover.png" }));
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(repo);
    await removeDir(other);
  }
});
