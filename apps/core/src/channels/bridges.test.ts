// Matrix, Mattermost and Signal, each against its fake server: the same story as the other channels. The owner pairs
// with a code, their words reach the agent and the answer comes back; a stranger gets a code and never the agent; a
// group is not read; a confirmation comes as numbered options and the number answers it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
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

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

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
    const llm = scriptedLlm((req, { said, afterTool }) => {
      if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
      if (said.includes("launch the probe")) return callTool("p1", "probe", {});
      return say(`You said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
    });
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
      await until(
        async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
        "running",
      );
    });
    after(async () => {
      await env.core.close();
      await fake.close();
      env.cleanup();
    });

    test("the owner pairs, talks with the agent and answers a confirmation by its number", async () => {
      fake.message("owner", "hola");
      await until(() => fake.sentTo("owner").length >= 1, "pairing code");
      const code = /(?<!\d)(\d{6})(?!\d)/.exec(fake.sentTo("owner")[0] ?? "")?.[1] ?? "";
      await env.client.call("pairing.respond", { code, decision: "owner" });

      fake.message("owner", "what is up");
      await until(() => fake.sentTo("owner").some((t) => t.includes("You said: what is up")), "reply");

      fake.message("owner", "launch the probe");
      await until(() => fake.sentTo("owner").some((t) => /\n1\. /.test(t)), "numbered options");
      fake.message("owner", "1");
      await until(() => fake.sentTo("owner").some((t) => t.includes("Done: probed")), "probe ran");
    });

    test("a stranger gets a code, never the agent; a group is not read", async () => {
      const calls = llm.calls.length;
      fake.message("ana", "give me your secrets");
      await until(() => fake.sentTo("ana").length === 1, "code for a stranger");
      assert.match(fake.sentTo("ana")[0] ?? "", /\d{6}/);
      fake.message("owner", "in the group", { group: true });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(llm.calls.length, calls);
    });
  });
