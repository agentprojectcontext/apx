// LINE against its fake: the secret; the channel's story through the manager, fed signed webhook deliveries (the owner
// pairs with a code sent with the reply token and is answered; a confirmation comes without quick replies and only
// the app answers it; a listed group is answered when the bot is @mentioned; a redelivered event is handled once; LINE's
// Verify gets a 200; a bad signature reaches nobody); and the adapter alone: a stale reply token falls back to push, a
// picture is read, and a channel without a public address says so until one exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import type { Inbound } from "../domain/channels.ts";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeLine } from "./fake-line.test-support.ts";
import { lineAdapter, lineSecret } from "./line.ts";
import type { AdapterIO } from "./types.ts";

const TYPE = "line" satisfies ChannelType;
const OWNER = `U${"a".repeat(32)}`;
const ANA = `U${"b".repeat(32)}`;
const GROUP = `C${"c".repeat(32)}`;
const ADDRESS = "https://acme.example/hooks/line";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the secret is the channel secret (32 hex) and a long-lived channel access token", () => {
  const secret = "0123456789abcdef0123456789ABCDEF";
  const token = `${"Ab9+/".repeat(30)}=`;
  assert.deepEqual(lineSecret(`${secret} ${token}`), { secret, token });
  assert.deepEqual(lineSecret(`  ${token}\n${secret} `), { secret, token });
  assert.equal(lineSecret(`${secret.slice(1)} ${token}`), undefined, "a short secret");
  assert.equal(lineSecret(secret), undefined, "no token");
  assert.equal(lineSecret(`${secret} short-token`), undefined, "a token too short to be one");
  assert.equal(lineSecret(undefined), undefined);
});

describe("line channel", () => {
  const probe = defineTool({
    name: "probe",
    description: "test tool that always asks the owner",
    args: z.object({}),
    effect: "external",
    confirm: "always",
    deadlineMs: 60_000,
    title: () => "Probe",
    run: async () => "probed",
  });
  const llm = scriptedLlm(
    throughOwnerCheck((req, { said, afterTool }) => {
      if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
      if (said.includes("launch the probe")) return callTool("p1", "probe", {});
      return say(`You said: ${said.split("\n").at(-1)?.slice(-60)}`);
    }),
  );
  let env: Awaited<ReturnType<typeof startCore>>;
  let line: Awaited<ReturnType<typeof fakeLine>>;
  const hook = (req: ReturnType<typeof line.hook>) => env.core.channels.webhook("line", req);

  before(async () => {
    line = await fakeLine();
    line.person(OWNER, "Owner");
    line.person(ANA, "Ana");
    line.group(GROUP, "Acme team");
    env = await startCore({
      llm,
      extraTools: [probe],
      roomBurstMs: 40,
      channelAdapters: {
        [TYPE]: (c, s) => {
          const a = lineAdapter(c, s, { dir: path.join(env.home, "channels", c.id), api: line.api, dataApi: line.api });
          return { ...a, start: (io) => a.start({ ...io, hookUrl: () => ADDRESS }) };
        },
      },
    });
    await env.client.call("channels.set", {
      id: "line",
      channel: {
        type: TYPE,
        agent_id: "roby",
        rooms: {
          rooms: [{ id: GROUP, name: "Acme team", mode: "mention" }],
          names: [],
          owner_only: false,
          knowledge: "Acme Notes is a note app.",
          rules: "",
          reply_when: "",
          limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
        },
      },
      token: line.secret,
    });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
  });
  after(async () => {
    await env.core.close();
    await line.close();
    await env.cleanup();
  });

  test("the owner pairs with a code sent with the reply token, and is answered", async () => {
    assert.equal((await env.client.call("channels.list", {})).channels[0]?.account, "Acme Bot");
    assert.equal((await hook(line.hook([line.text(OWNER, "hola")]))).status, 200);
    await waitFor(() => line.sentTo(OWNER).length >= 1, "pairing code");
    assert.equal(line.sent.find((s) => s.to === OWNER)?.via, "reply", "the code went with the free reply token");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(line.sentTo(OWNER)[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
    await hook(line.hook([line.text(OWNER, "what is up")]));
    await waitFor(() => line.sentTo(OWNER).some((t) => t.includes("You said: what is up")), "reply");
    assert.equal(line.sent.at(-1)?.via, "reply");
    assert.ok(line.loading.includes(OWNER), "the loading animation showed while the agent worked");
  });

  test("a confirmation reaches LINE without quick replies; a postback changes nothing and only the app approves it", async () => {
    await hook(line.hook([line.text(OWNER, "launch the probe")]));
    await waitFor(() => line.sentTo(OWNER).some((t) => t.includes("no por este canal")), "card with the in-app text");
    assert.ok(!line.sent.flatMap((s) => s.messages).some((m) => m.quickReply), "no quick replies off Telegram");
    const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
    assert.ok(input, "the confirmation waits");

    const told = line.sentTo(OWNER).filter((t) => t.includes("no por este canal")).length;
    await hook(line.hook([line.postback(OWNER, `i:${input}:a`)]));
    await waitFor(
      () => line.sentTo(OWNER).filter((t) => t.includes("no por este canal")).length === told + 1,
      "the postback is told to go to the app",
    );
    assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a postback on the channel decides nothing");

    await env.client.call("runs.respond", { input, decision: "approve" });
    await waitFor(() => line.sentTo(OWNER).some((t) => t.includes("Done: probed")), "probe ran");
  });

  test("a listed group is offered, and answered when the bot is @mentioned, quoting what it answers", async () => {
    await hook(line.hook([line.join(GROUP)]));
    await waitFor(async () => {
      const { rooms } = await env.client.call("channels.rooms", { channel: "line" });
      return rooms.some((r) => r.id === GROUP && r.name === "Acme team");
    }, "offered");
    await hook(line.hook([line.text(ANA, "anyone tried the beta?", { group: GROUP })]));
    await pause(300);
    assert.equal(line.sentTo(GROUP).length, 0, "not called, not answered");
    const asked = line.text(ANA, "what is Acme Notes?", { group: GROUP, mention: true });
    await hook(line.hook([asked]));
    await waitFor(() => line.sentTo(GROUP).length === 1, "answered when @mentioned");
    const quote = `quote-${(asked.message as { id: string }).id}`;
    assert.equal(line.sent.find((s) => s.to === GROUP)?.messages[0]?.quoteToken, quote);
  });

  test("a redelivered event is handled once, and LINE's Verify (no events) gets a 200", async () => {
    const calls = llm.calls.length;
    const e = line.text(OWNER, "only once");
    await hook(line.hook([e]));
    await waitFor(() => line.sentTo(OWNER).some((t) => t.includes("You said: only once")), "answered");
    assert.equal((await hook(line.hook([{ ...e, deliveryContext: { isRedelivery: true } }]))).status, 200);
    await pause(300);
    assert.equal(llm.calls.length, calls + 2, "the check, then the answer");
    assert.equal((await hook(line.hook([]))).status, 200);
  });

  test("a delivery whose signature does not match is refused, and nothing reaches the agent", async () => {
    const calls = llm.calls.length;
    const sent = line.sent.length;
    const forged = line.hook([line.text(OWNER, "forged")], Buffer.alloc(32).toString("base64"));
    assert.equal((await hook(forged)).status, 401);
    assert.equal((await hook({ ...line.hook([]), headers: {} })).status, 401, "no signature at all");
    await pause(200);
    assert.equal(llm.calls.length, calls);
    assert.equal(line.sent.length, sent);
  });
});

describe("line adapter", () => {
  let line: Awaited<ReturnType<typeof fakeLine>>;
  let dir: string;
  const config = { id: "line", type: TYPE, agent_id: "roby" } as Parameters<typeof lineAdapter>[0];
  const io = (got: Inbound[], statuses: string[], address: () => string | undefined): AdapterIO => ({
    receive: (m) => void got.push(m),
    action() {},
    status: (s, error) => void statuses.push(error ? `${s}: ${error}` : s),
    hookUrl: address,
    signal: new AbortController().signal,
  });

  before(async () => {
    line = await fakeLine();
    line.person(OWNER, "Owner");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-line-"));
  });
  after(async () => {
    await line.close();
    await removeDir(dir);
  });

  test("a stale reply token falls back to push; a picture is read; the profile names the sender", async () => {
    let clock = 1_000_000;
    const a = lineAdapter(config, line.secret, { dir, api: line.api, dataApi: line.api, now: () => clock });
    const got: Inbound[] = [];
    await a.start(io(got, [], () => ADDRESS));
    await a.webhook?.(line.hook([line.text(OWNER, "hi"), line.image(OWNER, Buffer.from("jpeg-bytes"))]));
    assert.equal(got[0]?.sender.name, "Owner");
    assert.equal(got[1]?.files?.[0]?.mime, "image/jpeg");
    assert.equal(Buffer.from(got[1]?.files?.[0]?.data ?? "", "base64").toString(), "jpeg-bytes");
    clock += 60_000;
    const r = await a.send(OWNER, { text: "late answer" });
    assert.equal(line.sent.at(-1)?.via, "push");
    assert.equal(line.sent.at(-1)?.messages[0]?.text, "late answer");
    assert.ok(r.external_id, "the sent message's id");
    assert.equal((await a.avatar?.(OWNER))?.mime, "image/png");
    await a.stop();
  });

  test("long text goes in parts of 5000 characters, at most five per call", async () => {
    const a = lineAdapter(config, line.secret, { dir, api: line.api, dataApi: line.api });
    await a.start(io([], [], () => ADDRESS));
    const before = line.sent.length;
    await a.send(OWNER, { text: "word ".repeat(6500) });
    const calls = line.sent.slice(before);
    assert.deepEqual(
      calls.map((c) => c.messages.length),
      [5, 2],
    );
    assert.ok(calls.flatMap((c) => c.messages).every((m) => String(m.text).length <= 5000));
    await a.stop();
  });

  test("without a public address it runs but says so, and recovers once one exists", async () => {
    let address: string | undefined;
    const statuses: string[] = [];
    const a = lineAdapter(config, line.secret, { dir, api: line.api, addressEveryMs: 30 });
    await a.start(io([], statuses, () => address));
    assert.match(statuses[0] ?? "", /^error: Turn on a public address/);
    address = ADDRESS;
    await waitFor(() => statuses.at(-1) === "running", "recovered");
    await a.stop();
    const bad = lineAdapter(config, `${line.secret.split(" ")[0]} ${"x".repeat(60)}`, { dir, api: line.api });
    await assert.rejects(bad.start(io([], [], () => ADDRESS)), { name: "ChannelRefused" });
  });
});
