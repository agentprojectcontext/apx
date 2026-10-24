// IRC against a fake server: the line format both directions, the secret, and the channel's story through the manager.
// The owner pairs over a private message and is answered; a listed #room is joined and answered there when the bot is
// addressed; a nick in use gets an underscore; SASL carries the password; long text stays within IRC's 512 bytes.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { type FakeIrc, fakeIrc } from "./fake-irc.test-support.ts";
import { ircAdapter, ircLine, ircSecret, parseIrcLine, plainIrc, splitBytes } from "./irc.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROOMS = {
  rooms: [{ id: "#acme", name: "#acme", mode: "mention" as const }],
  names: [],
  owner_only: false,
  knowledge: "Acme Notes is a note app.",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
};

test("a line parses into tags, prefix, command and params, the trailing one with its spaces", () => {
  assert.deepEqual(
    parseIrcLine("@msgid=abc;account=ana;+draft/reply=x\\sy\\:z :ana!a@host PRIVMSG #acme :hi there\r\n"),
    {
      tags: { msgid: "abc", account: "ana", "+draft/reply": "x y;z" },
      prefix: "ana!a@host",
      nick: "ana",
      command: "PRIVMSG",
      params: ["#acme", "hi there"],
    },
  );
  assert.deepEqual(parseIrcLine("PING :irc.example.org"), {
    tags: {},
    command: "PING",
    params: ["irc.example.org"],
  });
  assert.deepEqual(parseIrcLine(":irc.example.org 001 apx :Welcome")?.params, ["apx", "Welcome"]);
  assert.deepEqual(parseIrcLine(":s CAP * LS * :sasl")?.params, ["*", "LS", "*", "sasl"]);
  assert.equal(parseIrcLine(""), undefined);
  assert.equal(parseIrcLine("@only-tags"), undefined);
});

test("a line out escapes tags, puts a colon before a trailing param and never carries a line break", () => {
  assert.equal(ircLine("PRIVMSG", ["#acme", "hello world"]), "PRIVMSG #acme :hello world");
  assert.equal(ircLine("NICK", ["apx"]), "NICK apx");
  assert.equal(ircLine("PRIVMSG", ["ana", ":)"]), "PRIVMSG ana ::)");
  assert.equal(ircLine("PRIVMSG", ["ana", ""]), "PRIVMSG ana :");
  assert.equal(
    ircLine("PRIVMSG", ["#acme", "a\r\nQUIT :bye"], { "+draft/reply": "x y;z" }),
    "@+draft/reply=x\\sy\\:z PRIVMSG #acme :a  QUIT :bye",
  );
  const back = parseIrcLine(ircLine("PRIVMSG", ["#a b", "x"], { k: "a\\b" }));
  assert.deepEqual([back?.params, back?.tags], [["#ab", "x"], { k: "a\\b" }]);
});

test("text splits by bytes at spaces, whole characters; formatting codes are dropped", () => {
  const parts = splitBytes("ñandú ".repeat(40), 50);
  assert.ok(parts.every((p) => Buffer.byteLength(p) <= 50));
  assert.equal(parts.join(" "), "ñandú ".repeat(40).trim());
  assert.ok(splitBytes("é".repeat(30), 7).every((p) => p === "ééé"));
  assert.equal(plainIrc("\u0002bold\u0002 \u000304,01red\u0003 2024 \u001Funder"), "bold red 2024 under");
});

test("the secret is the server's address, the nick and an optional password", () => {
  assert.deepEqual(ircSecret("ircs://irc.example.org:6697 apxbot s3cret"), {
    host: "irc.example.org",
    port: 6697,
    tls: true,
    nick: "apxbot",
    password: "s3cret",
  });
  assert.deepEqual(ircSecret("irc://irc.example.org apx_bot"), {
    host: "irc.example.org",
    port: 6667,
    tls: false,
    nick: "apx_bot",
  });
  assert.deepEqual(ircSecret("ircs://irc.example.org"), { host: "irc.example.org", port: 6697, tls: true });
  assert.deepEqual(ircSecret("https://irc.example.org 1bad"), {});
});

describe("irc channel", () => {
  const llm = scriptedLlm(
    throughOwnerCheck((req, { said }) => {
      if (said.includes("long please")) return say(`${"word ".repeat(300)}end`);
      return say(`You said: ${String(req.messages.at(-1)?.content).split("\n").at(-1)?.slice(-60)}`);
    }),
  );
  let env: Awaited<ReturnType<typeof startCore>>;
  let irc: FakeIrc;
  const texts = (to: string) => irc.sentTo(to).map((s) => s.text);

  before(async () => {
    irc = await fakeIrc({ taken: ["apxbot"] });
    env = await startCore({ llm, roomBurstMs: 40, channelAdapters: { irc: ircAdapter } });
    await env.client.call("channels.set", {
      id: "irc",
      channel: { type: "irc", agent_id: "roby", rooms: ROOMS },
      token: `${irc.url} apxbot`,
    });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
  });
  after(async () => {
    await env.core.close();
    await irc.close();
    await env.cleanup();
  });

  test("a nick in use gets an underscore, and the listed room is joined", async () => {
    assert.equal(irc.nick(), "apxbot_");
    await waitFor(() => irc.joined.has("#acme"), "joined #acme");
    assert.ok(irc.lines.includes("CAP REQ :message-tags account-tag"));
    assert.equal((await env.client.call("channels.list", {})).channels[0]?.account, "apxbot_");
  });

  test("the owner pairs by private message and is answered there", async () => {
    irc.message("owner", "hola");
    await waitFor(() => texts("owner").length >= 1, "pairing code");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(texts("owner")[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
    irc.message("owner", "what is up");
    await waitFor(() => texts("owner").some((t) => t.includes("You said: what is up")), "reply");
  });

  test("a long answer goes as several lines, each within 512 bytes as relayed", async () => {
    const before_ = texts("owner").length;
    irc.message("owner", "long please");
    await waitFor(() => texts("owner").some((t) => t.endsWith("end")), "long reply", { ms: 8000 });
    const lines = texts("owner").slice(before_);
    assert.ok(lines.length > 1);
    for (const l of lines)
      assert.ok(Buffer.byteLength(`:apxbot_!uuuuuuuuuu@${"h".repeat(63)} PRIVMSG owner :${l}\r\n`) <= 512);
  });

  test("in the room only an address to the bot is answered, in the room, as a reply to it", async () => {
    irc.message("ana", "anyone tried the beta?", { room: "#acme" });
    await pause(200);
    assert.equal(texts("#acme").length, 0, "not called, not answered");
    irc.message("ana", "apxbot_: what is Acme Notes?", { room: "#ACME" });
    await waitFor(() => texts("#acme").length === 1, "answered when addressed");
    const room = env.core.store.threads.byConversation("irc", "#acme");
    const kept = env.core.store.messages
      .list(room?.id ?? "")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
    assert.ok(kept.includes("what is Acme Notes?"), "the address to the bot is dropped from the text");
    assert.match(irc.sentTo("#acme")[0]?.tags["+draft/reply"] ?? "", /^m\d+$/);
    assert.equal(texts("ana").length, 0, "the answer goes to the room, not to the person");
  });

  test("an unlisted room is offered in the rooms picker and never answered", async () => {
    irc.message("ana", "apxbot_: hello", { room: "#northwind" });
    await waitFor(
      async () =>
        (await env.client.call("channels.rooms", { channel: "irc" })).rooms.some((r) => r.id === "#northwind"),
      "offered",
    );
    await pause(150);
    assert.equal(texts("#northwind").length, 0);
  });
});

test("with a password and SASL offered, the bot logs in by SASL PLAIN and never sends PASS", async () => {
  const irc = await fakeIrc({ password: "s3cret-pass", sasl: true });
  const adapter = ircAdapter(
    { id: "irc", type: "irc" } as Parameters<typeof ircAdapter>[0],
    `${irc.url} apx s3cret-pass`,
  );
  const ac = new AbortController();
  const io = { receive() {}, action() {}, status() {}, signal: ac.signal };
  assert.deepEqual(await adapter.start(io), { account: "apx" });
  assert.ok(irc.lines.includes("AUTHENTICATE PLAIN"));
  assert.ok(!irc.lines.some((l) => l.startsWith("PASS")));
  ac.abort();
  await adapter.stop();

  const wrong = ircAdapter({ id: "irc", type: "irc" } as Parameters<typeof ircAdapter>[0], `${irc.url} apx nope-nope`);
  await assert.rejects(wrong.start({ ...io, signal: new AbortController().signal }), /refused the bot's password/);
  await wrong.stop();
  await irc.close();
});
