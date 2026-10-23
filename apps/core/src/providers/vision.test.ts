import assert from "node:assert/strict";
import { test } from "node:test";
import { readsImages } from "./vision.ts";

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
  for (const m of ["fake/fake-1", "ollama/phi4", "ollama/qwen3:8b"]) assert.equal(readsImages(m), undefined, m);
});
