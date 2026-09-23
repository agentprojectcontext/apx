// A spent account is not a busy one.
//
// 2026-09-23: the ChatGPT subscription answered "The usage limit has been
// reached" while ~230 a2a turns were in flight. Each one treated it like a
// burst and walked the chain — Gemini (503), Ollama cloud (its own monthly
// limit), the local model — and nobody was told. These tests pin the three
// things that should have happened instead: the account cools down, an
// unwatched turn stops rather than spending the other providers, and the
// owner hears about it once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-quota-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  isQuotaExhaustedError, markQuotaExhausted, quotaCooldown, claimQuotaNotice, _resetQuotaCooldowns,
} = await import("#core/agent/quota.js");
const { runAgent } = await import("#core/agent/run-agent.js");
const { resolveActiveModel } = await import("#core/agent/model-router.js");
const { resolveAgentModel } = await import("#core/agent/agent-model.js");
const { callEngineWithFallback } = await import("#core/agent/engine-call.js");
const { notifyOwnerQuotaStop } = await import("#core/routines/delivery.js");
const { CHANNELS } = await import("#core/constants/channels.js");

beforeEach(() => _resetQuotaCooldowns());

const SPENT = "mock:quota-exhausted";
const SPARE = "mock:test";
const config = () => ({
  super_agent: { model: SPENT, model_fallback: { enabled: true, models: [SPARE] }, stuck_detection: { enabled: false } },
  engines: {},
});
const run = (channel, cfg = config()) => runAgent({
  globalConfig: cfg, system: "sys", prompt: "hola", toolSchemas: [], makeToolHandlers: () => ({}),
  toolHandlerCtx: { channel },
});

test("the providers' own wording of a spent plan is told apart from a burst", () => {
  assert.ok(isQuotaExhaustedError(new Error("codex-plus 429: The usage limit has been reached")));
  assert.ok(isQuotaExhaustedError(new Error('ollama 429: {"error":"you (someone) have reached your monthly usage limit, upgrade"}')));
  assert.ok(isQuotaExhaustedError(new Error("openai 429: You exceeded your current quota, please check your plan")));
  // A burst keeps rotating: these must NOT read as an empty account.
  assert.ok(!isQuotaExhaustedError(new Error("zen 429: Rate limit exceeded. Please try again later.")));
  assert.ok(!isQuotaExhaustedError(new Error("gemini 503: This model is currently experiencing high demand.")));
});

test("an unwatched turn stops on a spent account instead of spending the chain", async () => {
  for (const channel of [CHANNELS.A2A, CHANNELS.ROUTINE]) {
    _resetQuotaCooldowns();
    await assert.rejects(run(channel), (e) => e.code === "QUOTA_EXHAUSTED" && e.modelId === SPENT, channel);
  }
});

test("a person in a chat still falls through to the next model", async () => {
  const out = await run(CHANNELS.WEB);
  assert.ok(out.text, "the turn answered on the spare model");
  assert.ok(quotaCooldown(SPENT), "and the spent account is now cooling down");
});

test("while it cools, the router skips it without spending a call on it", async () => {
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  const routing = await resolveActiveModel(config());
  assert.equal(routing.modelId, SPARE);
  assert.equal(routing.tried[0].reason, "quota exhausted");
  // …and an unwatched turn does not quietly run on what was left.
  await assert.rejects(run(CHANNELS.ROUTINE), /usage limit is spent/);
});

test("an inheriting agent's unwatched turn stops; one pinned to its own model does not", async () => {
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  const inherits = { fields: { Model: "inherit" } };
  await assert.rejects(resolveAgentModel({ agent: inherits, config: config(), autonomous: true }), /usage limit is spent/);
  assert.equal(await resolveAgentModel({ agent: inherits, config: config() }), SPARE, "a watched turn still rotates");
  const pinned = { fields: { Model: "ollama:qwen3:8b" } };
  assert.equal(await resolveAgentModel({ agent: pinned, config: config(), autonomous: true }), "ollama:qwen3:8b");
});

test("one-shot calls start past a cooled account too", async () => {
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  const out = await callEngineWithFallback({ modelId: SPENT, config: config(), messages: [{ role: "user", content: "hola" }] });
  assert.equal(out.model, SPARE);
});

test("the owner hears about a spent account once, not once per routine", async () => {
  const sent = [];
  const tg = { send: async (m) => { sent.push(m); } };
  const err = Object.assign(new Error("x"), { code: "QUOTA_EXHAUSTED", modelId: SPENT });
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  // No model to write it: the floor, in the owner's language — never a string
  // hardcoded in one language for every install.
  const ctx = { plugins: { get: () => tg }, globalConfig: { user: { language: "pt-BR" } } };
  assert.equal(await notifyOwnerQuotaStop(ctx, { err, routine: { name: "acme-pulse" } }), true);
  assert.equal(await notifyOwnerQuotaStop(ctx, { err, routine: { name: "acme-weekly" } }), false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ficou sem cota/);
  assert.match(sent[0].text, /acme-pulse/);
  // A new window is a new notice.
  _resetQuotaCooldowns();
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  assert.equal(claimQuotaNotice(SPENT), true);
});

test("with a model available, the notice is model-authored", async () => {
  const sent = [];
  let asked = null;
  const ctx = {
    plugins: { get: () => ({ send: async (m) => { sent.push(m); } }) },
    globalConfig: { super_agent: { model: SPARE }, user: { language: "en" } },
  };
  const err = Object.assign(new Error("x"), { code: "QUOTA_EXHAUSTED", modelId: SPENT });
  markQuotaExhausted(SPENT, new Error("usage limit reached"));
  await notifyOwnerQuotaStop(ctx, {
    err, routine: { name: "acme-pulse" },
    callFn: async (args) => { asked = args; return { text: "⚠️ the model wrote this" }; },
  });
  assert.equal(sent[0].text, "⚠️ the model wrote this");
  assert.match(asked.messages[0].content, /acme-pulse/, "the facts reach the model");
});

// Found live on 2026-09-23, after the first version of this file shipped:
// `luna@high` cooled down, and the chain's plain `luna` — same ChatGPT account
// — was called again one step later and paid a second 429.
test("a cooldown covers the account, whatever reasoning suffix reached it", () => {
  markQuotaExhausted("chatgpt-codex:gpt-5.6-luna@high", new Error("usage limit reached"));
  assert.ok(quotaCooldown("chatgpt-codex:gpt-5.6-luna"));
  assert.ok(quotaCooldown("chatgpt-codex:gpt-5.6-luna@medium"));
  // A different model on a shared slug is not assumed to share the account:
  // `ollama:` is both a cloud plan and a free local model.
  assert.equal(quotaCooldown("ollama:qwen3:8b"), null);
});

// Same live run: the super-agent's own model failed and the turn walked the
// fallback list — which leaves the router's #1 out — so it never tried the
// router default and ended on the slowest local model.
test("when a preferred model fails, the router's own #1 is tried before the fallbacks", async () => {
  const events = [];
  const cfg = {
    super_agent: {
      model: SPARE, model_fallback: { enabled: true, models: ["mock:fail-503"] }, stuck_detection: { enabled: false },
    },
    engines: {},
  };
  const out = await runAgent({
    globalConfig: cfg, system: "sys", prompt: "hola", toolSchemas: [], makeToolHandlers: () => ({}),
    toolHandlerCtx: { channel: CHANNELS.WEB }, preferredModel: SPENT, preferredBy: "self_model",
    onEvent: (e) => events.push(e),
  });
  assert.ok(out.text);
  const failed = events.find((e) => e.type === "engine_failed");
  assert.equal(failed.model, SPENT);
  assert.equal(failed.retry_with, SPARE, "the router default, not the next fallback");
});
