// Matrix, Mattermost and Signal, each against its fake server: the same story as the other channels. The owner pairs
// with a code, their words reach the agent and the answer comes back; a stranger gets a code and never the agent; a
// group is not read. Matrix and Mattermost cannot vouch for the owner, so a confirmation comes without options and only
// the app answers it; Signal proves the sending account, so its options are answered there (DECISIONS.md#d-150).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { ownerActsOn } from "../domain/channels.ts";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { type FakeBridge, fakeMatrix, fakeMattermost, fakeSignal } from "./fake-bridges.test-support.ts";
import { matrixAdapter, matrixSecret } from "./matrix.ts";
import { mattermostAdapter, mattermostSecret } from "./mattermost.ts";
import { signalAdapter, signalSecret } from "./signal.ts";
import type { AdapterFactory } from "./types.ts";

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

test("each secret splits into the server's address and the token or number, in any order", () => {
  assert.deepEqual(matrixSecret("syt_x https://m.example.org/"), {
    homeserver: "https://m.example.org",
    token: "syt_x",
  });
  assert.deepEqual(mattermostSecret("https://chat.example.org abc"), {
    server: "https://chat.example.org",
    token: "abc",
  });
  assert.deepEqual(signalSecret("+15550001111 http://127.0.0.1:8080"), {
    url: "http://127.0.0.1:8080",
    account: "+15550001111",
  });
  assert.deepEqual(signalSecret("http://127.0.0.1:8080 15550001111"), { url: "http://127.0.0.1:8080" });
});

const CASES: Array<{ type: ChannelType; fake: () => Promise<FakeBridge>; adapter: AdapterFactory }> = [
  { type: "matrix", fake: fakeMatrix, adapter: matrixAdapter },
  { type: "mattermost", fake: fakeMattermost, adapter: mattermostAdapter },
  { type: "signal", fake: fakeSignal, adapter: signalAdapter },
];

for (const c of CASES)
  describe(c.type, () => {
    const llm = scriptedLlm(
      throughOwnerCheck((req, { said, afterTool }) => {
        if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
        if (said.includes("launch the probe")) return callTool("p1", "probe", {});
        return say(`You said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
      }),
    );
    let env: Awaited<ReturnType<typeof startCore>>;
    let fake: FakeBridge;

    before(async () => {
      fake = await c.fake();
      env = await startCore({ llm, extraTools: [probe], channelAdapters: { [c.type]: c.adapter } });
      await env.client.call("channels.set", {
        id: c.type,
        channel: { type: c.type, agent_id: "roby" },
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

    const pairOwner = async () => {
      fake.message("owner", "hola");
      await waitFor(() => fake.sentTo("owner").length >= 1, "pairing code");
      const code = /(?<!\d)(\d{6})(?!\d)/.exec(fake.sentTo("owner")[0] ?? "")?.[1] ?? "";
      await env.client.call("pairing.respond", { code, decision: "owner" });

      fake.message("owner", "what is up");
      await waitFor(() => fake.sentTo("owner").some((t) => t.includes("You said: what is up")), "reply");
    };

    if (ownerActsOn(c.type))
      test("the owner pairs and talks; a confirmation reaches them with options and their typed number answers it", async () => {
        await pairOwner();
        const calls = llm.calls.length;
        fake.message("owner", "launch the probe");
        await waitFor(() => fake.sentTo("owner").some((t) => /\n1\. /.test(t)), "card with options");
        assert.ok(
          llm.calls.slice(calls).every((r) => !JSON.stringify(r.messages).includes("Judge first")),
          "no check by the super-agent first",
        );
        fake.message("owner", "1");
        await waitFor(() => fake.sentTo("owner").some((t) => t.includes("Done: probed")), "probe ran");
      });
    else
      test("the owner pairs and talks; a confirmation reaches them without options and a typed number does not answer it, only the app does", async () => {
        await pairOwner();

        fake.message("owner", "launch the probe");
        await waitFor(() => fake.sentTo("owner").some((t) => t.includes("no por este canal")), "card without options");
        const card = fake.sentTo("owner").find((t) => t.includes("no por este canal")) ?? "";
        assert.ok(!/\n1\. /.test(card), "no numbered options off Telegram");
        const { inputs } = await env.client.call("runs.pending", {});
        const input = inputs[0]?.id ?? "";
        assert.ok(input, "the confirmation waits");

        fake.message("owner", "1");
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a typed number answers nothing");

        await env.client.call("runs.respond", { input, decision: "approve" });
        await waitFor(() => fake.sentTo("owner").some((t) => t.includes("Done: probed")), "probe ran");
        await waitFor(
          () => fake.sentTo("owner").some((t) => t.includes("You said: 1")),
          "the number was relayed as words",
        );
      });

    test("a stranger gets a code, never the agent; a group is not read", async () => {
      const calls = llm.calls.length;
      fake.message("ana", "give me your secrets");
      await waitFor(() => fake.sentTo("ana").length === 1, "code for a stranger");
      assert.match(fake.sentTo("ana")[0] ?? "", /\d{6}/);
      fake.message("owner", "in the group", { group: true });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(llm.calls.length, calls);
    });
  });
