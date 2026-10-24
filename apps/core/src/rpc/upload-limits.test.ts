import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Attached")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

for (const transport of ["http", "ws"] as const) {
  test(`${transport}: a 5.3 MB video survives upload, send and retrieval`, async () => {
    const socket = transport === "ws" ? await env.client.connect() : undefined;
    const client = socket ?? env.client;
    try {
      const bytes = Buffer.alloc(5_333_561, 7);
      const { media } = await client.call("media.upload", {
        name: "clip.mp4",
        mime: "video/mp4",
        data: bytes.toString("base64"),
        thread: "home",
      });
      assert.equal(media.bytes, bytes.length);
      assert.equal(media.kind, "file");
      const { message } = await client.call("threads.send", {
        thread: "home",
        text: "Keep this clip",
        attachments: [media.id],
      });
      await env.settle("home");
      const saved = (await client.call("threads.get", { thread: "home" })).messages.find((m) => m.id === message.id);
      assert.ok(saved?.parts.some((p) => p.type === "file" && p.media_id === media.id && p.mime === "video/mp4"));
      const retrieved = await client.call("media.get", { id: media.id });
      assert.equal(retrieved.mime, "video/mp4");
      assert.deepEqual(Buffer.from(retrieved.data, "base64"), bytes);
    } finally {
      socket?.close();
      if (socket) await socket.closed;
    }
  });

  test(`${transport}: documents accept 20 MB and reject larger files without storing them`, async () => {
    const socket = transport === "ws" ? await env.client.connect() : undefined;
    const client = socket ?? env.client;
    try {
      const bytes = Buffer.alloc(20 * 1024 * 1024, 7);
      const { media } = await client.call("media.upload", {
        name: "report.pdf",
        mime: "application/pdf",
        data: bytes.toString("base64"),
        thread: "home",
      });
      assert.equal(media.bytes, bytes.length);
      const retrieved = await client.call("media.get", { id: media.id });
      assert.deepEqual(Buffer.from(retrieved.data, "base64"), bytes);
      await assert.rejects(
        client.call("media.upload", {
          name: "oversized.pdf",
          mime: "application/pdf",
          data: Buffer.alloc(bytes.length + 1, 7).toString("base64"),
          thread: "home",
        }),
        /oversized\.pdf is over 20 MB/,
      );
      assert.equal(env.core.store.media.named("home", "oversized.pdf").length, 0);
    } finally {
      socket?.close();
      if (socket) await socket.closed;
    }
  });
}
