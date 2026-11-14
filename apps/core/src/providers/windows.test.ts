import assert from "node:assert/strict";
import { test } from "node:test";
import { contextWindow } from "./windows.ts";

test("known model families report their context window; unknown ones do not invent one", () => {
  assert.equal(contextWindow("anthropic/claude-sonnet-4-5"), 200_000);
  assert.equal(contextWindow("google/gemini-2.5-pro"), 1_048_576);
  assert.equal(contextWindow("openai/gpt-4o-mini"), 128_000);
  assert.equal(contextWindow("openai/o3"), 128_000);
  assert.equal(contextWindow("gemini/gemini-4-argon"), 1_048_576);
  assert.equal(contextWindow("gemini/gemini-flash-latest"), 1_048_576);
  assert.equal(contextWindow("anthropic/claude-sonnet-5-5"), 1_000_000);
  assert.equal(contextWindow("acme/house-model"), undefined);
});

test("GPT-6 API windows differ from the Codex and ChatGPT plan defaults", () => {
  for (const model of ["gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra"]) {
    assert.equal(contextWindow(`openai/${model}`), 1_050_000, model);
    assert.equal(contextWindow(`openrouter/openai/${model}`), 1_050_000, model);
    assert.equal(contextWindow(`codex/${model}`), 500_000, model);
    assert.equal(contextWindow(`chatgpt/${model}#high`), 500_000, model);
  }
  assert.equal(contextWindow("openai/gpt-5.4"), 400_000);
  assert.equal(contextWindow("openai/gpt-60"), undefined);
});

test("Gemma 4 windows distinguish small and medium models, including local tags", () => {
  for (const model of [
    "google/gemma-4-26b-a4b-it",
    "google/gemma-4-31b-it",
    "ollama/gemma4:31b",
    "ollama/gemma4:26b-a4b",
    "google/gemma-4-12b-it",
  ]) {
    assert.equal(contextWindow(model), 262_144, model);
  }
  for (const model of ["google/gemma-4-e2b-it", "ollama/gemma4:e4b"]) {
    assert.equal(contextWindow(model), 131_072, model);
  }
  assert.equal(contextWindow("ollama/gemma4:unknown"), undefined);
  assert.equal(contextWindow("google/gemma-40-31b"), undefined);
});

test("GPT-OSS windows are known without assuming vision support", () => {
  for (const model of ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "ollama/gpt-oss:20b"]) {
    assert.equal(contextWindow(model), 131_072, model);
  }
});
