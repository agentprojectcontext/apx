// Source-level guards for the LangChain engine toggle. The actual
// AgentExecutor invocation isn't tested here because it requires the
// underlying provider (Anthropic / Ollama / OpenAI) to be reachable;
// integration tests for that live in CI runs with cassettes.
//
// What we DO test from source:
//   - super-agent.js explicitly delegates to super-agent-langchain.js
//     when sa.engine === "langchain"
//   - DEFAULT_SYSTEM is exported so the adapter can reuse the prompt
//   - the adapter file imports the expected langchain packages

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = fs.readFileSync(
  path.join(__dirname, "..", "src", "daemon", "super-agent.js"), "utf8");
const LC = fs.readFileSync(
  path.join(__dirname, "..", "src", "daemon", "super-agent-langchain.js"), "utf8");

test("super-agent.js delegates to langchain adapter when engine === 'langchain'", () => {
  assert.match(
    NATIVE,
    /sa\.engine\s*===\s*"langchain"[\s\S]{0,300}runSuperAgentLangChain\(/,
    "the toggle must dispatch to runSuperAgentLangChain",
  );
});

test("super-agent.js exports DEFAULT_SYSTEM so the adapter can reuse it", () => {
  assert.match(NATIVE, /^export const DEFAULT_SYSTEM = /m);
});

test("langchain adapter imports the four core langchain packages", () => {
  assert.match(LC, /from\s+["']langchain\/agents["']/, "agents");
  assert.match(LC, /from\s+["']@langchain\/core\/prompts["']/, "core prompts");
  assert.match(LC, /from\s+["']@langchain\/core\/tools["']/, "core tools");
  assert.match(LC, /from\s+["']@langchain\/core\/messages["']/, "core messages");
});

test("langchain adapter exposes the same return-shape contract", () => {
  // Adapter must return {text, usage, name, trace}
  assert.match(LC, /return\s*\{\s*[\s\S]*?text,[\s\S]*?usage:[\s\S]*?name:[\s\S]*?trace,?[\s\S]*?\}/);
});

test("langchain adapter has a MAX_ITER_DEFAULT >= 10 to give the loop room", () => {
  const m = LC.match(/MAX_ITER_DEFAULT\s*=\s*(\d+)/);
  assert.ok(m, "MAX_ITER_DEFAULT must be defined");
  assert.ok(Number(m[1]) >= 10, `MAX_ITER_DEFAULT too low: ${m[1]}`);
});

test("langchain adapter passes the AbortSignal to executor.invoke", () => {
  assert.match(LC, /executor\.invoke\(\s*\{[\s\S]*?\}\s*,\s*\{\s*signal\s*\}\s*\)/);
});

test("isLangChainEngineSelected only returns true for the explicit value", () => {
  assert.match(LC, /export function isLangChainEngineSelected\(cfg\) \{[\s\S]*?cfg\?\.super_agent\?\.engine === "langchain"/);
});
