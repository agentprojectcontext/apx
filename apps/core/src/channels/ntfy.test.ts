// ntfy against a fake server: the owner's topic is the owner (or pairs with a code when the channel does not say so),
// their words reach the agent and the answer is published back; APX never reads its own messages; a dropped stream
// picks up after the last message read; a refused token stops the channel.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeNtfy } from "./fake-ntfy.test-support.ts";
import { NTFY_OWNER, ntfyAdapter, ntfySecret } from "./ntfy.ts";
import { type AdapterIO, ChannelRefused } from "./types.ts";

// The protocol may not list ntfy yet: the adapter then runs under another type's name.
const TYPE = "ntfy" satisfies ChannelType;

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

test("the secret splits into the server, the topic and an optional token", () => {
  assert.deepEqual(ntfySecret("https://ntfy.sh/ apx-abc123 tk_xyz"), {
    server: "https://ntfy.sh",
    topic: "apx-abc123",
    token: "tk_xyz",
  });
  assert.deepEqual(ntfySecret("tk_xyz apx-abc123 https://ntfy.example.org"), {
    server: "https://ntfy.example.org",
    topic: "apx-abc123",
    token: "tk_xyz",
  });
  assert.deepEqual(ntfySecret("https://ntfy.sh apx_abc"), { server: "https://ntfy.sh", topic: "apx_abc" });
  assert.equal(ntfySecret("apx-abc123"), undefined, "no server");
  assert.equal(ntfySecret("https://ntfy.sh"), undefined, "no topic");
  assert.equal(ntfySecret("https://ntfy.sh bad/topic"), undefined, "not a topic name");
  assert.equal(ntfySecret(undefined), undefined);
});

for (const selfOwner of [true, false])
  describe(selfOwner ? "a topic that is the owner" : "a topic paired with a code", () => {
    const llm = scriptedLlm(
      throughOwnerCheck((req, { said, afterTool }) => {
        if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
        if (said.includes("launch the probe")) return callTool("p1", "probe", {});
        return say(`You said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
      }),
    );
    let env: Awaited<ReturnType<typeof startCore>>;
    let fake: Awaited<ReturnType<typeof fakeNtfy>>;

    before(async () => {
      fake = await fakeNtfy();
      env = await startCore({
        llm,
        extraTools: [probe],
        channelAdapters: { [TYPE]: (c, s) => ntfyAdapter(c, s, { dir: path.join(env.home, "channels", c.id) }) },
      });
      await env.client.call("channels.set", {
        id: "ntfy",
        channel: { type: TYPE, agent_id: "roby", ...(selfOwner ? { self_owner: true } : {}) },
        token: fake.secret,
      });
      await waitFor(
        async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
        "running",
      );
    });
    after(async () => {
      await env.core.close();
      await fake.close();
      await env.cleanup();
    });

    test("the owner talks with the agent; a confirmation comes without options, a typed number does not answer it and only the app does", async () => {
      if (!selfOwner) {
        fake.write("hola");
        await waitFor(() => fake.published().length >= 1, "pairing code");
        const code = /(?<!\d)(\d{6})(?!\d)/.exec(fake.published()[0] ?? "")?.[1] ?? "";
        await env.client.call("pairing.respond", { code, decision: "owner" });
      }
      const { persons } = await env.client.call("contacts.list", {});
      const owner = persons.find((p) => p.role === "owner");
      assert.ok(owner?.addresses.some((a) => a.channel === "ntfy" && a.external_id === NTFY_OWNER));

      fake.write("what is up");
      await waitFor(() => fake.published().some((t) => t.includes("You said: what is up")), "reply");

      fake.write("launch the probe");
      await waitFor(() => fake.published().some((t) => t.includes("no por este canal")), "card without options");
      assert.ok(!fake.published().some((t) => /\n1\. /.test(t)), "no numbered options off Telegram");
      const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
      assert.ok(input, "the confirmation waits");
      fake.write("1");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a typed number answers nothing");
      await env.client.call("runs.respond", { input, decision: "approve" });
      await waitFor(() => fake.published().some((t) => t.includes("Done: probed")), "probe ran");
      await waitFor(() => fake.published().some((t) => t.includes("You said: 1")), "the number was relayed as words");

      // Its own messages come back on the stream: none of them is read as the owner's.
      const calls = llm.calls.length;
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(llm.calls.length, calls);
    });
  });

describe("the adapter alone", () => {
  let fake: Awaited<ReturnType<typeof fakeNtfy>>;
  let dir: string;
  before(async () => {
    fake = await fakeNtfy();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-ntfy-"));
  });
  after(async () => {
    await fake.close();
    await removeDir(dir);
  });

  const config = { id: "ntfy", type: "signal", label: "ntfy", agent_id: "roby" } as Parameters<typeof ntfyAdapter>[0];
  const io = (got: Array<{ text: string; files?: unknown[] }>, ac: AbortController): AdapterIO => ({
    receive: (m) => got.push({ text: m.text, ...(m.files ? { files: m.files } : {}) }),
    action: () => {},
    status: () => {},
    signal: ac.signal,
  });

  test("a dropped stream picks up after the last message, and a restart never replays", async () => {
    const got: Array<{ text: string; files?: unknown[] }> = [];
    const ac = new AbortController();
    const a = ntfyAdapter(config, fake.secret, { dir });
    await a.start(io(got, ac));
    await waitFor(() => fake.subscribes.length === 1, "subscribed");
    fake.write("one");
    fake.picture("cat.png", Buffer.from("png-bytes"));
    await waitFor(() => got.length === 2, "two in");
    assert.deepEqual(got[1], {
      text: "",
      files: [{ name: "cat.png", mime: "image/png", data: Buffer.from("png-bytes").toString("base64") }],
    });
    fake.drop();
    fake.write("two");
    await waitFor(() => got.some((m) => m.text === "two"), "read after reconnecting");
    assert.equal(fake.subscribes.at(-1), "m2", "resumes after the last message read");
    await a.stop();

    const again: typeof got = [];
    const b = ntfyAdapter(config, fake.secret, { dir });
    await b.start(io(again, new AbortController()));
    await waitFor(() => fake.subscribes.length >= 3, "subscribed again");
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(again, [], "nothing read twice");
    await b.stop();
  });

  test("a refused token stops the channel until the owner changes it", async () => {
    const bad = fake.secret.replace(/tk_\w+/, "tk_wrong");
    const a = ntfyAdapter(config, bad, { dir });
    await assert.rejects(a.start(io([], new AbortController())), ChannelRefused);
    await assert.rejects(ntfyAdapter(config, "apx-only", { dir }).start(io([], new AbortController())), ChannelRefused);
  });
});
