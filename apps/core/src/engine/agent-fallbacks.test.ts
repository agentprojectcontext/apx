// An agent's own fallback models (DECISIONS.md#d-195): the real gateway over stand-in providers, on the test's clock.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { ProviderConfig } from "../config.ts";
import { createLlm, NO_KEY } from "../providers/llm.ts";
import { createSecrets } from "../secrets.ts";
import { startCore } from "./testkit.ts";

const provider = (id: string): ProviderConfig => ({
  id,
  transport: "openai-chat",
  base_url: `http://${id}.test`,
  key: NO_KEY,
  models: [],
});
const providers = ["pa", "pb", "pc", "pd"].map(provider);

// The provider's reset is read against real time (an implausible one is dropped): the test's clock starts there.
let clock = Math.ceil(Date.now() / 1000) * 1000;
const reset = () => new Date(clock + 4 * 3600_000).toISOString();
/** How each model answers right now, by "provider/model"; absent answers. */
const answers = new Map<string, () => Response>();
const asked: string[] = [];

const limited = (until: string) => () =>
  new Response(JSON.stringify({ error: { type: "usage_limit_reached", resets_at: Date.parse(until) / 1000 } }), {
    status: 429,
  });
const reply = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\ndata: [DONE]`,
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );

const llm = createLlm({
  providers: () => providers,
  secrets: createSecrets("/nonexistent", "file", {}),
  firstByteMs: 1000,
  retryDelayMs: 1,
  now: () => clock,
  fetchImpl: (async (url: string, init: RequestInit) => {
    const ref = `${new URL(url).hostname.replace(/\.test$/, "")}/${(JSON.parse(String(init.body)) as { model: string }).model}`;
    asked.push(ref);
    return answers.get(ref)?.() ?? reply(`from ${ref}`);
  }) as typeof fetch,
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, providers, clock: () => new Date(clock) });
  env.core.store.settings.write("model_router", { rules: [], chain: ["pd/native"] });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});
beforeEach(() => {
  answers.clear();
  asked.length = 0;
});

async function agentWith(slug: string, fallbacks?: string[]) {
  await env.client.call("agents.create", {
    slug,
    name: slug,
    role: "Helper",
    prompt: "",
    model_choice: { model: "pa/main", router: true, ...(fallbacks ? { fallbacks } : {}) },
  });
  return slug;
}

async function turn(agent: string, text = "hello") {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
  await env.client.call("threads.send", { thread: t.id, text });
  const done = await env.settle(t.id);
  const run = done.runs.at(-1);
  const answer = done.messages.findLast((m) => m.author.kind === "agent");
  const fellBack = Boolean(answer?.parts.some((p) => p.type === "notice" && p.code === "engine.fallback"));
  return { run, answer, fellBack };
}
const askedOf = (ref: string) => asked.filter((r) => r === ref).length;

test("main held → own fallback 1 → own fallback 2 → the router's chain, and back to main after its reset", async () => {
  const agent = await agentWith("robina", ["pb/one", "pc/two"]);
  const until = reset();
  answers.set("pa/main", limited(until));

  const first = await turn(agent);
  assert.equal(first.run?.state, "completed");
  assert.equal(first.run?.model, "pb/one", "the run records the model that answered");
  assert.equal(first.answer?.model, "pb/one");
  assert.ok(first.fellBack, "the answer is marked as a fallback's");

  // A held model is never asked again before its reset: the next turn goes straight to the fallback.
  const second = await turn(agent);
  assert.equal(second.run?.model, "pb/one");
  assert.equal(askedOf("pa/main"), 1);

  answers.set("pb/one", limited(until));
  assert.equal((await turn(agent)).run?.model, "pc/two");
  answers.set("pc/two", limited(until));
  const native = await turn(agent);
  assert.equal(native.run?.model, "pd/native", "after its own list, the router's chain");
  assert.equal(askedOf("pa/main"), 1);

  // Past the reset the main model answers again at the next turn, by itself.
  clock = Date.parse(until) + 1000;
  answers.clear();
  const back = await turn(agent);
  assert.equal(back.run?.model, "pa/main");
  assert.equal(back.fellBack, false);
});

test("a retryable error is tried again on the main model before the fallback; one that is not moves on at once", async () => {
  const agent = await agentWith("retry", ["pb/one"]);
  answers.set("pa/main", () => new Response("overloaded", { status: 503 }));
  const busy = await turn(agent);
  assert.equal(busy.run?.model, "pb/one");
  assert.equal(askedOf("pa/main"), 4, "an overload is retried on the same model");

  // Not a usage limit: the main model is not held, so the next turn asks it again.
  asked.length = 0;
  answers.set("pa/main", () => new Response("bad tool schema", { status: 400 }));
  const refused = await turn(agent);
  assert.equal(refused.run?.model, "pb/one");
  assert.equal(askedOf("pa/main"), 1, "a rejected request is not retried");

  answers.clear();
  assert.equal((await turn(agent)).run?.model, "pa/main");
});

test("an agent without fallbacks of its own keeps today's order: its model, then the router's chain", async () => {
  const agent = await agentWith("plain");
  answers.set("pa/main", limited(reset()));
  const t = await turn(agent);
  assert.equal(t.run?.model, "pd/native");
  assert.ok(t.fellBack);
  assert.ok(!asked.includes("pb/one") && !asked.includes("pc/two"));
});

test("a fallback must be a model API an agent can run on", async () => {
  await assert.rejects(
    env.client.call("agents.create", {
      slug: "bad",
      name: "bad",
      role: "Helper",
      prompt: "",
      model_choice: { model: "pa/main", router: true, fallbacks: ["nowhere/x"] },
    }),
    /unknown engine "nowhere"/,
  );
});
