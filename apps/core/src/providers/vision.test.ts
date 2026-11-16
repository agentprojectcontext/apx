import assert from "node:assert/strict";
import { test } from "node:test";
import { imageLimit, readsImages } from "./vision.ts";

test("the documented Groq image cap applies only to its exact Qwen 3.8 model", () => {
  assert.equal(imageLimit("groq/qwen/qwen3.8-27b"), 3);
  assert.equal(imageLimit("groq/qwen/qwen3.8-27b#high"), 3);
  for (const model of ["openrouter/qwen/qwen3.8-27b", "groq/qwen/qwen3-32b", "groq/qwen/qwen3.8-27b-preview"])
    assert.equal(imageLimit(model), undefined, model);
});

test("Gemma 3n retains image support in local and hosted model refs", () => {
  for (const model of ["ollama/gemma3n:e4b", "google/gemma-3n-e4b-it"]) assert.equal(readsImages(model), true, model);
  for (const model of ["ollama/gemma4n:e4b", "google/gemma-4n-e4b-it", "google/gemma-30n-e4b-it"])
    assert.equal(readsImages(model), undefined, model);
});

test("Qwen 3.8 27B reads images without assuming vision for other Qwen models", () => {
  for (const model of ["groq/qwen/qwen3.8-27b", "openrouter/qwen/qwen3.8-27b", "groq/qwen/qwen3.8-27b#high"])
    assert.equal(readsImages(model), true, model);
  for (const model of ["groq/qwen/qwen3-32b", "groq/qwen/qwen3.8-270b", "groq/qwen/qwen3.8-27b-preview"])
    assert.equal(readsImages(model), undefined, model);
});

test("models known to read images, known not to, and unknown ones", () => {
  for (const m of [
    "anthropic/claude-sonnet-4-5",
    "gemini/gemini-2.5-flash",
    "openai/gpt-4o-mini",
    "openai/gpt-5",
    "chatgpt/gpt-6-luna",
    "openai/o3",
    "openai/o4-mini",
    "ollama/llava:13b",
    "ollama/qwen2.5-vl:7b",
    "openrouter/meta-llama/llama-3.2-11b-vision-instruct",
    "ollama/gemma3:12b",
    "google/gemma-4-26b-a4b-it",
    "google/gemma-4-31b-it",
    "ollama/gemma4:31b",
    "ollama/gemma4:26b-a4b",
  ])
    assert.equal(readsImages(m), true, m);
  for (const m of [
    "deepseek/deepseek-chat",
    "openrouter/deepseek/deepseek-r1",
    "openai/o3-mini",
    "groq/llama-3.3-70b-versatile",
    "ollama/llama3.1:8b",
    "openrouter/openai/gpt-oss-120b",
    "mistral/codestral-latest",
  ])
    assert.equal(readsImages(m), false, m);
  for (const m of ["fake/fake-1", "ollama/phi4", "ollama/qwen3:8b", "google/gemma-40-31b"])
    assert.equal(readsImages(m), undefined, m);
});
