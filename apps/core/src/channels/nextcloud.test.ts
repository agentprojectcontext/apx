// Nextcloud Talk against a fake server: the secret, and the channel's story through the manager. What was said before
// the channel started is never answered; the owner pairs in a one-to-one conversation and is answered there; a listed
// group conversation is answered when the bot is @mentioned, as a reply; the place reached is kept across a restart.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { type FakeNextcloud, fakeNextcloud } from "./fake-nextcloud.test-support.ts";
import { nextcloudAdapter, nextcloudSecret } from "./nextcloud.ts";
import type { AdapterIO } from "./types.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROOMS = {
  rooms: [{ id: "grpacme", name: "Acme team", mode: "mention" as const }],
  names: [],
  owner_only: false,
  knowledge: "Acme Notes is a note app.",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
};

test("the secret is the server's address, the bot's user and its app password", () => {
  assert.deepEqual(nextcloudSecret("https://cloud.example.org/ apxbot Abcde-Fghij-Klmno-Pqrst-Uvwxy"), {
    server: "https://cloud.example.org",
    user: "apxbot",
    password: "Abcde-Fghij-Klmno-Pqrst-Uvwxy",
  });
  assert.deepEqual(nextcloudSecret("apxbot"), { user: "apxbot" });
});

describe("nextcloud channel", () => {
  const llm = scriptedLlm(
    throughOwnerCheck((_req, { said }) => say(`You said: ${said.split("\n").at(-1)?.slice(-60)}`)),
  );
  let env: Awaited<ReturnType<typeof startCore>>;
  let nc: FakeNextcloud;
  let dir: string;
  const texts = (token: string) => nc.sentTo(token).map((s) => s.text);

  before(async () => {
    nc = await fakeNextcloud();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-nextcloud-"));
    nc.message("owner", "an old message from before");
    nc.group("grpacme", "Acme team");
    nc.group("grpnorthwind", "Northwind");
    env = await startCore({
      llm,
      roomBurstMs: 40,
      channelAdapters: { nextcloud: (c, s) => nextcloudAdapter(c, s, { dir, roomsEveryMs: 100 }) },
    });
    await env.client.call("channels.set", {
      id: "nextcloud",
      channel: { type: "nextcloud", agent_id: "roby", rooms: ROOMS },
      token: nc.secret,
    });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
  });
  after(async () => {
    await env.core.close();
    await nc.close();
    await env.cleanup();
    await removeDir(dir);
  });

  test("history is not answered; the owner pairs, is answered, and a system message is skipped", async () => {
    await pause(300);
    assert.equal(texts(nc.dm("owner")).length, 0, "nothing said before the channel started is answered");
    nc.message("owner", "hola");
    await waitFor(() => texts(nc.dm("owner")).length >= 1, "pairing code");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(texts(nc.dm("owner"))[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
    nc.message("owner", "call started", { system: true });
    nc.message("owner", "what is up");
    await waitFor(() => texts(nc.dm("owner")).some((t) => t.includes("You said: what is up")), "reply");
    assert.ok(!texts(nc.dm("owner")).some((t) => t.includes("call started")));
  });

  test("a new person's first message is read, though their conversation appeared after the start", async () => {
    nc.message("ana", "hi there");
    await waitFor(() => texts(nc.dm("ana")).length === 1, "code for a stranger");
    assert.match(texts(nc.dm("ana"))[0] ?? "", /\d{6}/);
  });

  test("group conversations are offered; a listed one is answered when the bot is @mentioned, as a reply", async () => {
    await waitFor(async () => {
      const { rooms } = await env.client.call("channels.rooms", { channel: "nextcloud" });
      return rooms.some((r) => r.id === "grpnorthwind" && r.name === "Northwind");
    }, "offered");
    nc.message("ana", "anyone tried the beta?", { room: "grpacme" });
    await pause(300);
    assert.equal(texts("grpacme").length, 0, "not called, not answered");
    const asked = nc.message("ana", "what is Acme Notes?", { room: "grpacme", mention: true });
    await waitFor(() => texts("grpacme").length === 1, "answered when @mentioned");
    assert.equal(nc.sentTo("grpacme")[0]?.replyTo, asked);
    nc.message("ana", "hello", { room: "grpnorthwind", mention: true });
    await pause(300);
    assert.equal(texts("grpnorthwind").length, 0, "an unlisted group is never answered");
  });
});

test("the place reached survives a restart, and reactions go on and come off", async () => {
  const nc = await fakeNextcloud();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-nextcloud-"));
  const config = { id: "nc", type: "nextcloud", agent_id: "roby" } as Parameters<typeof nextcloudAdapter>[0];
  const got: string[] = [];
  const io = (): AdapterIO => ({
    receive: (m) => void got.push(m.text),
    action() {},
    status() {},
    signal: new AbortController().signal,
  });
  nc.message("owner", "before");
  let adapter = nextcloudAdapter(config, nc.secret, { dir, roomsEveryMs: 100 });
  await adapter.start(io());
  nc.message("owner", "first");
  await waitFor(() => got.includes("first"), "first");
  await adapter.stop();
  nc.message("owner", "while stopped");
  adapter = nextcloudAdapter(config, nc.secret, { dir, roomsEveryMs: 100 });
  await adapter.start(io());
  await waitFor(() => got.includes("while stopped"), "caught up after the restart");
  assert.deepEqual(got, ["first", "while stopped"]);

  await adapter.react?.(nc.dm("owner"), "101", "👍");
  await adapter.react?.(nc.dm("owner"), "101", "");
  assert.deepEqual(nc.reactions, [
    { token: nc.dm("owner"), id: "101", emoji: "👍" },
    { token: nc.dm("owner"), id: "101", emoji: "👍", removed: true },
  ]);
  await adapter.stop();
  await adapter.forget?.();
  assert.equal(fs.existsSync(path.join(dir, "nextcloud-state.json")), false);
  await nc.close();
  await removeDir(dir);
});
