import assert from "node:assert/strict";
import { test } from "node:test";
import { contextWindow } from "./windows.ts";

test("Qwen 3.8 27B uses its documented window without changing other Qwen fallbacks", () => {
  for (const model of ["groq/qwen/qwen3.8-27b", "openrouter/qwen/qwen3.8-27b", "groq/qwen/qwen3.8-27b#high"])
    assert.equal(contextWindow(model), 131_072, model);
  for (const model of ["groq/qwen/qwen3-32b", "groq/qwen/qwen3.8-270b", "groq/qwen/qwen3.8-27b-preview"])
    assert.equal(contextWindow(model), 128_000, model);
});

test("Groq ALLaM uses only its exact documented context fallback", () => {
  for (const model of ["groq/allam-2-7b", "groq/allam-2-7b#high", "GROQ/ALLAM-2-7B"])
    assert.equal(contextWindow(model), 4_096, model);
  for (const model of [
    "groq/allam-2-70b",
    "groq/allam-2-7b-preview",
    "groq/allam-2-7b-vision",
    "groq/allam-2-7b:latest",
    "acme/allam-2-7b",
    "groq/acme/allam-2-7b",
  ])
    assert.equal(contextWindow(model), undefined, model);
});

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

test("GPT-5.6 Sol has its documented API window without changing other GPT-5 models", () => {
  for (const model of ["openai/gpt-5.6-sol", "openrouter/openai/gpt-5.6-sol", "openai/gpt-5.6-sol#high"]) {
    assert.equal(contextWindow(model), 1_050_000, model);
  }
  assert.equal(contextWindow("openai/gpt-5.6-luna"), 400_000);
  assert.equal(contextWindow("openai/gpt-5.4"), 400_000);
  for (const model of ["openai/gpt-6-terra", "openai/gpt-6.1-astra", "openai/gpt-6.1-luna"]) {
    assert.equal(contextWindow(model), undefined, model);
  }
});

test("documented Claude 4 windows preserve older and unrelated variants", () => {
  for (const model of ["claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6"]) {
    assert.equal(contextWindow(`anthropic/${model}`), 1_000_000, model);
    assert.equal(contextWindow(`anthropic/${model}-20260101#high`), 1_000_000, model);
  }
  for (const model of [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-sonnet-4-8",
    "claude-opus-4-60",
  ]) {
    assert.equal(contextWindow(`anthropic/${model}`), 200_000, model);
  }
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
