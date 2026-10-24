import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type ChannelAdapter, ChannelRefused } from "./types.ts";

// A platform that fails its first starts the way an unreachable network does, then works; "refused" never does.
const starts = { flaky: 0, refused: 0 };
const adapter = (id: "flaky" | "refused"): ChannelAdapter => ({
  caps: { typing: false, buttons: false },
  async start() {
    starts[id]++;
    if (id === "refused") throw new ChannelRefused("bad token");
    if (starts.flaky < 3) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    return { account: "@flaky_bot" };
  },
  async stop() {},
  async send() {
    return {};
  },
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    channelAdapters: { telegram: (c) => adapter(c.id === "refused" ? "refused" : "flaky") },
    channelRetryMs: [20, 40],
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const info = async (id: string) => (await env.client.call("channels.list", {})).channels.find((c) => c.id === id);

test("a channel that could not reach its platform says why and starts again on its own", async () => {
  await env.client.call("channels.set", {
    id: "flaky",
    channel: { type: "telegram", agent_id: "roby" },
    token: "123456:TEST",
  });
  const first = await info("flaky");
  assert.equal(first?.status, "error");
  assert.equal(first?.error, "fetch failed (ENOTFOUND)");
  const end = Date.now() + 3000;
  while ((await info("flaky"))?.status !== "running" && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.equal((await info("flaky"))?.status, "running");
  assert.equal(starts.flaky, 3);
});

test("a refused token is not retried", async () => {
  await env.client.call("channels.set", {
    id: "refused",
    channel: { type: "telegram", agent_id: "roby" },
    token: "123456:TEST",
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(starts.refused, 1);
  assert.equal((await info("refused"))?.error, "bad token");
});
