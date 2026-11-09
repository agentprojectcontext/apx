import assert from "node:assert/strict";
import { test } from "node:test";
import { discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";
import { SendError } from "./types.ts";

const TOKEN = "fake-forum-token";

async function fixture() {
  const dc = await fakeDiscord(TOKEN);
  dc.guild.channels = [{ id: "8001", name: "requests", type: 15 }];
  const adapter = discordAdapter(
    {
      id: "dc",
      type: "discord",
      label: "Discord",
      enabled: true,
      agent_id: "superagent",
      strangers: "pair",
      concurrency: "steer",
      owner_thread: "home",
      rooms: {
        rooms: [{ id: "8001", name: "requests", mode: "read" }],
        names: [],
        owner_only: false,
        reply_when: "",
        knowledge: "",
        rules: "",
        limits: { user_cooldown_s: 1, room_replies_per_hour: 30, checks_per_hour: 120 },
      },
    },
    TOKEN,
    dc.urls,
  );
  return {
    dc,
    adapter,
    close: async () => {
      await adapter.stop();
      await dc.close();
    },
  };
}

test("forum discovery and posting use a thread with a title and a safe starter, not a parent message", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.adapter.rooms?.(), [{ id: "8001", name: "requests", server: "Acme", writable: true }]);
    const text = "QA requests / Pedidos\nEnglish first.\nEspañol después. @everyone @ana";
    const result = await f.adapter.send("8001", { text, mentions: [{ handle: "ana", id: "222" }] });
    const posted = f.dc.sent.filter((s) => s.method === "POST");
    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.route, "/channels/8001/threads");
    assert.deepEqual(posted[0]?.body, {
      name: "QA requests / Pedidos",
      message: {
        content: "QA requests / Pedidos\nEnglish first.\nEspañol después. @everyone <@222>",
        allowed_mentions: { parse: [], users: ["222"] },
      },
    });
    assert.ok(result.external_id);
    assert.equal(f.dc.messagesTo("8001").length, 0);
  } finally {
    await f.close();
  }
});

test("forum requests reject oversized text and attachments without creating a partial topic", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.adapter.send("8001", { text: "x".repeat(2001) }), /at most 2000/);
    await assert.rejects(
      f.adapter.send("8001", { text: "title" }, [
        { kind: "file", data: Buffer.from("x"), mime: "text/plain", name: "test.txt" },
      ]),
      /no files/,
    );
    assert.equal(f.dc.sent.filter((s) => s.method === "POST").length, 0);
  } finally {
    await f.close();
  }
});

test("forum permission failures are fatal and uncertain creation never becomes an automatic retry", async () => {
  const f = await fixture();
  try {
    for (const [status, kind] of [
      [403, "fatal"],
      [500, "uncertain"],
    ] as const) {
      f.dc.failures.set("POST /channels/8001/threads", [{ status, body: { message: "Refused" } }]);
      await assert.rejects(
        f.adapter.send("8001", { text: "QA" }),
        (err: unknown) => err instanceof SendError && err.kind === kind,
      );
    }
    assert.equal(f.dc.messagesTo("8001").length, 0);
  } finally {
    await f.close();
  }
});
