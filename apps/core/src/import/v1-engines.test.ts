import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { v1Ref } from "./v1-engines.ts";

let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  // gemini, anthropic and openai built in, as on a real install.
  env = await startCore({ llm: scriptedLlm(() => say("ok")), providers: loadConfig({}, false).providers });
  const file = path.join(env.home, "v1", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      engines: {
        groq: {
          api_key: "test-key-groq",
          base_url: "https://api.groq.com/openai/v1",
          default_model: "m",
          is_active: true,
        },
        openrouter: { api_key: "test-key-openrouter", base_url: "https://openrouter.ai/api/v1" },
        zen: { engine: "zen", base_url: "https://opencode.ai/zen/v1/", api_key: "test-key-zen", model: "big-pickle" },
        cerebras: { base_url: "https://api.cerebras.ai/v1" },
        openai: { api_key: "test-key-openai", base_url: "https://api.openai.com/v1", is_active: false },
        anthropic: { api_key: "test-key-anthropic", is_active: false },
        gemini: { api_keys: ["test-key-gemini-1", "test-key-gemini-2"], default_model: "gemini-3.7-flash" },
        ollama: { base_url: "http://ollama.example.test:11434", default_model: "gemma4:31b-cloud" },
        "chatgpt-codex": { engine: "codex-plus", locked: true },
        "claude-subscription": { engine: "claude-subscription" },
        azure: { api_key: "test-key-azure" },
      },
      super_agent: {
        model: "zen:big-pickle",
        self_model: "chatgpt-codex:gpt-x@medium",
        model_fallback: {
          enabled: true,
          models: [
            "gemini:gemini-3.7-flash",
            "ollama:gemma4:31b-cloud",
            "chatgpt-codex:gpt-x@high",
            "cerebras:llama-x",
            "claude-subscription:claude-opus-x@max",
            "zen:big-pickle",
          ],
        },
      },
    }),
  );
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("v1 model refs read as v2's: engine renamed, model kept with its colons, effort only for the ChatGPT plan", () => {
  const engines = new Map([
    ["ollama", "ollama"],
    ["chatgpt-codex", "chatgpt"],
    ["anthropic", "anthropic"],
    ["groq", "groq"],
  ]);
  assert.equal(v1Ref("ollama:gemma4:31b-cloud", engines), "ollama/gemma4:31b-cloud");
  assert.equal(v1Ref("chatgpt-codex:gpt-x@medium", engines), "chatgpt/gpt-x#medium");
  assert.equal(v1Ref("chatgpt-codex:", engines), undefined, "the plan needs its model too");
  assert.equal(v1Ref("groq:openai/gpt-oss-20b@high", engines), "groq/openai/gpt-oss-20b");
  assert.equal(v1Ref("claude-haiku-4-5", engines), "anthropic/claude-haiku-4-5");
  assert.equal(v1Ref("groq:", engines), undefined, "a provider needs its model");
  assert.equal(v1Ref("cerebras:llama-x", engines), undefined, "an engine v2 does not have");
});

test("the scan counts the engines v2 can take", async () => {
  const { groups } = await env.client.call("setup.v1_scan", {});
  // groq, openrouter, zen, openai, anthropic, gemini, ollama, the ChatGPT plan; not cerebras (no key), not azure,
  // not the Claude plan (it runs only in Claude Code).
  assert.equal(groups.find((g) => g.id === "keys")?.count, 8);
});

test("importing brings v1's engines as providers with keys by reference, and its model chain", async () => {
  const r = await env.client.call("setup.import_v1", { groups: ["keys"] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.imported.keys, 8);

  const { providers } = await env.client.call("providers.list", {});
  const by = new Map(providers.map((p) => [p.id, p]));
  assert.deepEqual(
    ["groq", "openrouter", "zen"].map((id) => [id, by.get(id)?.base_url, by.get(id)?.needs_key, by.get(id)?.key_set]),
    [
      ["groq", "https://api.groq.com/openai/v1", true, true],
      ["openrouter", "https://openrouter.ai/api/v1", true, true],
      ["zen", "https://opencode.ai/zen/v1", true, true],
    ],
  );
  assert.equal(by.get("zen")?.preset, "opencode-zen");
  const ollama = by.get("ollama");
  assert.equal(ollama?.base_url, "http://ollama.example.test:11434/v1");
  assert.equal(ollama?.needs_key, false, "Ollama is keyless");
  assert.ok(!by.has("cerebras") && !by.has("azure") && !by.has("chatgpt-codex") && !by.has("claude-subscription"));
  // Built-ins only get their key.
  for (const id of ["gemini", "anthropic", "openai"]) assert.equal(by.get(id)?.builtin, true);
  assert.ok(env.core.secrets.has("secret://gemini"), "the first of gemini's keys");
  // Keys live in the secret store, never in the saved provider settings.
  const saved = JSON.stringify(env.core.store.settings.read("providers"));
  assert.ok(!saved.includes("test-key"));
  assert.ok(saved.includes("secret://groq"));
  assert.ok(env.core.secrets.has("secret://groq") && env.core.secrets.has("secret://openrouter"));

  const config = await env.client.call("models.config", {});
  assert.deepEqual(config.default, { model: "zen/big-pickle", router: true });
  assert.deepEqual(config.router.chain, ["gemini/gemini-3.7-flash", "ollama/gemma4:31b-cloud", "chatgpt/gpt-x#high"]);
  // v2 takes the chain as valid: saving it back passes its checks.
  await env.client.call("models.set_config", { default: config.default, router: config.router });
  // v1's own model for the super-agent is its model choice, on the router (v1 fell back by default).
  const boss = env.core.store.agents.list().find((a) => a.kind === "secretary");
  assert.deepEqual(boss?.model_choice, { model: "chatgpt/gpt-x#medium", router: true });
});

test("importing again changes nothing: no second provider, no rewritten key", async () => {
  const before = JSON.stringify(env.core.store.settings.read("providers"));
  env.core.secrets.set("groq", "test-key-changed-in-v2");
  const r = await env.client.call("setup.import_v1", { groups: ["keys"] });
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.stringify(env.core.store.settings.read("providers")), before);
  assert.equal(env.core.secrets.resolve("secret://groq"), "test-key-changed-in-v2");
  const { providers } = await env.client.call("providers.list", {});
  assert.equal(providers.filter((p) => p.id === "groq").length, 1);
  assert.equal((await env.client.call("models.config", {})).router.chain.length, 3);
});
