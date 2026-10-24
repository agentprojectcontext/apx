// iMessage as a channel against a stand-in Messages database and sender: history is never answered, a stranger is
// only listed for the owner, an approved contact gets answers; groups, the owner's own messages and reactions are not
// read; a picture comes along; a restart never replays; off a Mac it refuses to start.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { imessageAdapter } from "./imessage.ts";
import { type AdapterIO, ChannelRefused } from "./types.ts";

// The protocol may not list imessage yet: the adapter then runs under another type's name.
const TYPE = "imessage" satisfies ChannelType;
const ANA = "+15550000002";

/** Messages' own tables, as much of them as the channel reads, and a way to add a message to them. */
function messagesDb(file: string) {
  const d = new DatabaseSync(file);
  d.exec(`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, is_from_me INTEGER,
      date INTEGER, handle_id INTEGER, item_type INTEGER DEFAULT 0, associated_message_type INTEGER DEFAULT 0,
      cache_has_attachments INTEGER DEFAULT 0);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, style INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT, mime_type TEXT, transfer_name TEXT);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);`);
  d.close();
  let n = 1;
  return function add(
    from: string,
    text: string,
    o: { me?: boolean; group?: boolean; reaction?: boolean; file?: { path: string; mime: string } } = {},
  ): void {
    const w = new DatabaseSync(file);
    try {
      w.prepare("INSERT OR IGNORE INTO handle (id) VALUES (?)").run(from);
      const h = w.prepare("SELECT ROWID AS id FROM handle WHERE id = ?").get(from) as { id: number };
      const chat = o.group ? "chat123456" : from;
      w.prepare(
        "INSERT INTO chat (chat_identifier, style) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM chat WHERE chat_identifier = ?)",
      ).run(chat, o.group ? 43 : 45, chat);
      const c = w.prepare("SELECT ROWID AS id FROM chat WHERE chat_identifier = ?").get(chat) as { id: number };
      const m = w
        .prepare(
          `INSERT INTO message (guid, text, is_from_me, date, handle_id, associated_message_type, cache_has_attachments)
           VALUES (?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(`guid-${n++}`, text, o.me ? 1 : 0, h.id, o.reaction ? 2000 : 0, o.file ? 1 : 0);
      w.prepare("INSERT INTO chat_message_join VALUES (?, ?)").run(c.id, m.lastInsertRowid);
      if (o.file) {
        const a = w
          .prepare("INSERT INTO attachment (filename, mime_type, transfer_name) VALUES (?, ?, ?)")
          .run(o.file.path, o.file.mime, path.basename(o.file.path));
        w.prepare("INSERT INTO message_attachment_join VALUES (?, ?)").run(m.lastInsertRowid, a.lastInsertRowid);
      }
    } finally {
      w.close();
    }
  };
}

describe("through the channels", () => {
  const llm = scriptedLlm((_req, { said }) => say(`Got it: ${said}`));
  const sent: Array<{ to: string; text: string }> = [];
  const textsTo = (to: string) => sent.filter((s) => s.to === to).map((s) => s.text);
  let env: Awaited<ReturnType<typeof startCore>>;
  let add: ReturnType<typeof messagesDb>;
  let db: string;

  before(async () => {
    env = await startCore({
      llm,
      channelAdapters: {
        [TYPE]: (c, s) =>
          imessageAdapter(c, s, {
            dir: path.join(env.home, "channels", c.id),
            db,
            pollMs: 30,
            platform: "darwin",
            send: async (to, text) => {
              sent.push({ to, text });
            },
          }),
      },
    });
    db = path.join(env.home, "chat.db");
    add = messagesDb(db);
    add(ANA, "an old message, never answered");
    await env.client.call("channels.set", { id: "imessage", channel: { type: TYPE, agent_id: "roby" } });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
  });
  after(async () => {
    await env.core.close();
    await env.cleanup();
  });

  test("a stranger is only listed; approved, they get answers; groups, own words and reactions are not read", async () => {
    const calls = llm.calls.length;
    add(ANA, "hi, it's Ana");
    await waitFor(
      async () => (await env.client.call("pairing.list", {})).requests.some((r) => r.name === ANA),
      "listed",
    );
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(sent, [], "no code, no answer, history untouched");
    assert.equal(llm.calls.length, calls);

    const code = (await env.client.call("pairing.list", {})).requests.find((r) => r.name === ANA)?.code ?? "";
    await env.client.call("pairing.respond", { code, decision: "contact" });
    add(ANA, "are you there?");
    // A contact's words reach the agent marked as untrusted; the scripted answer repeats them.
    await waitFor(
      () => textsTo(ANA).some((t) => t.startsWith("Got it:") && t.includes("are you there?")),
      "the contact's answer",
    );

    const quiet = llm.calls.length;
    add(ANA, "in the group", { group: true });
    add(ANA, "my own words", { me: true });
    add(ANA, "Loved “are you there?”", { reaction: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(llm.calls.length, quiet);
  });
});

describe("the adapter alone", () => {
  let dir: string;
  let add: ReturnType<typeof messagesDb>;
  let db: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-imessage-channel-"));
    db = path.join(dir, "Library", "Messages", "chat.db");
    fs.mkdirSync(path.dirname(db), { recursive: true });
    add = messagesDb(db);
  });
  after(() => removeDir(dir));

  const config = { id: "imessage", type: "signal", label: "iMessage", agent_id: "roby" } as Parameters<
    typeof imessageAdapter
  >[0];
  const io = (got: Array<{ text: string; files?: unknown[] }>): AdapterIO => ({
    receive: (m) => got.push({ text: m.text, ...(m.files ? { files: m.files } : {}) }),
    action: () => {},
    status: () => {},
    signal: new AbortController().signal,
  });
  const adapter = () =>
    imessageAdapter(config, undefined, { dir: path.join(dir, "state"), db, pollMs: 20, platform: "darwin" });

  test("a picture comes along from Messages' attachments, other files are named; a restart never replays", async () => {
    const pic = path.join(dir, "Library", "Messages", "Attachments", "cat.png");
    fs.mkdirSync(path.dirname(pic), { recursive: true });
    fs.writeFileSync(pic, "png-bytes");
    const got: Array<{ text: string; files?: unknown[] }> = [];
    const a = adapter();
    await a.start(io(got));
    add(ANA, "￼", { file: { path: "~/Library/Messages/Attachments/cat.png", mime: "image/png" } });
    add(ANA, "a photo￼", { file: { path: "~/Library/Messages/Attachments/x.heic", mime: "image/heic" } });
    await waitFor(() => got.length === 2, "two in");
    assert.deepEqual(got, [
      { text: "", files: [{ name: "cat.png", mime: "image/png", data: Buffer.from("png-bytes").toString("base64") }] },
      { text: "a photo\n[attachments not kept: x.heic (image/heic)]" },
    ]);
    await a.stop();

    const again: typeof got = [];
    const b = adapter();
    await b.start(io(again));
    add(ANA, "new one");
    await waitFor(() => again.length === 1, "only the new one");
    assert.deepEqual(again, [{ text: "new one" }]);
    await b.stop();
  });

  test("off a Mac it refuses to start", async () => {
    const a = imessageAdapter(config, undefined, { dir: path.join(dir, "x"), db, platform: "linux" });
    await assert.rejects(a.start(io([])), ChannelRefused);
  });
});
