import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("the owner adds a provider from the app: its key is stored, never returned, and its models are usable", async () => {
  const r = await env.client.call("providers.set", {
    id: "zen",
    provider: {
      label: "OpenCode Zen",
      preset: "opencode-zen",
      transport: "openai-chat",
      base_url: "https://zen.test/v1/",
    },
    api_key: "sk-test-123",
  });
  const zen = r.providers.find((p) => p.id === "zen");
  assert.equal(zen?.key_set, true);
  assert.equal(zen?.base_url, "https://zen.test/v1");
  assert.ok(!JSON.stringify(r).includes("sk-test-123"));
  // A model of it is a valid choice now, without a restart.
  await env.client.call("agents.update", { agent: "scout", model_choice: { model: "zen/big-pickle", router: true } });
});

test("a local server needs no key; a built-in provider can be removed", async () => {
  const r = await env.client.call("providers.set", {
    id: "ollama",
    provider: {
      transport: "openai-chat",
      base_url: "http://localhost:11434/v1",
      needs_key: false,
      models: ["qwen3:8b"],
    },
  });
  const o = r.providers.find((p) => p.id === "ollama");
  assert.equal(o?.key_set, true);
  assert.equal(o?.needs_key, false);
  const after = await env.client.call("providers.set", { id: "fake", provider: null });
  assert.ok(!after.providers.some((p) => p.id === "fake"));
});

test("harness ids cannot be added as providers", async () => {
  for (const id of ["claude", "codex", "native", "acp", "aider", "antigravity"]) {
    await assert.rejects(
      env.client.call("providers.set", {
        id,
        provider: { transport: "openai-chat", base_url: "https://acme.test/v1" },
        api_key: "test-key",
      }),
      (e: unknown) => e instanceof ApxError && e.code === "bad_request" && /reserved/.test(e.message),
    );
    assert.ok(!(await env.client.call("providers.list", {})).providers.some((p) => p.id === id));
    assert.equal(env.core.secrets.resolve(`secret://${id}`), undefined);
    await env.client.call("providers.set", { id, provider: null, api_key: "ignored-on-delete" });
    assert.equal(env.core.secrets.resolve(`secret://${id}`), undefined);
  }
});

test("only the owner manages providers", async () => {
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(
    agent.call("providers.list", {}),
    (e: unknown) => e instanceof ApxError && e.code === "unauthorized",
  );
});

test("built-in providers keep their brand's name and kind, even saved back as an older panel did", async () => {
  const own = await startCore({
    llm: scriptedLlm(() => say("ok")),
    providers: [
      {
        id: "openai",
        label: "OpenAI",
        transport: "openai-chat",
        base_url: "https://api.openai.com/v1",
        key: "secret://openai",
        models: [],
      },
    ],
  });
  try {
    const r = await own.client.call("providers.set", {
      id: "openai",
      provider: {
        label: "openai",
        preset: "custom",
        transport: "openai-chat",
        base_url: "https://api.openai.com/v1",
        enabled: false,
      },
    });
    const openai = r.providers.find((p) => p.id === "openai");
    assert.equal(openai?.label, "OpenAI");
    assert.equal(openai?.preset, undefined);
    assert.equal(openai?.enabled, false);
  } finally {
    await own.core.close();
    await own.cleanup();
  }
});
