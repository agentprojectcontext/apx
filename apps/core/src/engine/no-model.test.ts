import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ProviderError } from "../providers/types.ts";
import { scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({
    llm: scriptedLlm(() => {
      throw new ProviderError("rate_limit", "fake/fake-1: HTTP 429: You reached the Free usage limit");
    }),
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("when no model answers, the chat says so as an error with the reasons below, never as an answer", async () => {
  await env.client.call("threads.send", { thread: "home", text: "hello" });
  const t = await env.settle("home");
  const last = t.messages.at(-1);
  const notice = last?.parts.find((p) => p.type === "notice");
  assert.equal(notice?.type === "notice" && notice.level, "error");
  assert.equal(notice?.type === "notice" && notice.code, "run.noModel");
  assert.match(notice?.type === "notice" ? (notice.detail ?? "") : "", /HTTP 429/);
  assert.ok(!last?.parts.some((p) => p.type === "text"), "no text part pretends to be the agent's answer");
  assert.equal(t.runs[0]?.state, "failed");
});
