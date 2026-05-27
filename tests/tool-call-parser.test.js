import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "../src/core/agent/tool-call-parser.js";

test("extractPseudoToolCalls — single block with empty arguments", () => {
  const text = `<tool_call>
{"name": "list_agents", "arguments": {}}
</tool_call>`;
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "list_agents");
  assert.deepEqual(calls[0].function.arguments, {});
});

test("extractPseudoToolCalls — multiple blocks", () => {
  // Real output observed from qwen2.5:14b
  const text = `_icall()
{"name": "list_agents", "arguments": {}}
_icall()
{"name": "list_agents", "arguments": {"project": "APX testing sandbox"}}
</tool_call>
{"name": "send_telegram", "arguments": {"text": "In the project..."}}
</tool_call>`;
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].function.name, "list_agents");
  assert.equal(calls[1].function.name, "list_agents");
  assert.equal(calls[1].function.arguments.project, "APX testing sandbox");
  assert.equal(calls[2].function.name, "send_telegram");
  assert.match(calls[2].function.arguments.text, /^In the project/);
});

test("extractPseudoToolCalls — nested arguments object", () => {
  const text = `{"name": "call_mcp", "arguments": {"mcp": "filesystem", "tool": "read_file", "args": {"path": "./README.md", "encoding": "utf8"}}}`;
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "call_mcp");
  assert.deepEqual(calls[0].function.arguments.args, {
    path: "./README.md",
    encoding: "utf8",
  });
});

test("extractPseudoToolCalls — ignores plain JSON without {name, arguments}", () => {
  const text = `{"name": "alone"} and {"foo": 1, "bar": 2}`;
  assert.deepEqual(extractPseudoToolCalls(text), []);
});

test("extractPseudoToolCalls — handles strings containing braces", () => {
  const text = `{"name": "send_telegram", "arguments": {"text": "esto tiene { llaves } adentro"}}`;
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.arguments.text, "esto tiene { llaves } adentro");
});

test("cleanTextOfPseudoToolCalls — strips fences and JSON blocks", () => {
  const text = `Voy a hacer esto:
<tool_call>
{"name": "list_agents", "arguments": {}}
</tool_call>
And after this.`;
  const cleaned = cleanTextOfPseudoToolCalls(text);
  assert.match(cleaned, /^Voy a hacer esto/);
  assert.match(cleaned, /And after this\.$/);
  assert.doesNotMatch(cleaned, /tool_call/);
  assert.doesNotMatch(cleaned, /list_agents/);
});

test("cleanTextOfPseudoToolCalls — leaves clean text untouched", () => {
  const text = "Hello, how is it going?";
  assert.equal(cleanTextOfPseudoToolCalls(text), text);
});

test("cleanTextOfPseudoToolCalls — handles empty / null", () => {
  assert.equal(cleanTextOfPseudoToolCalls(""), "");
  assert.equal(cleanTextOfPseudoToolCalls(null), null);
});

// ── Llama-3.3 (via Groq/OpenRouter) dotted-function wrapper ─────────────────
// The format looks like:
//   <function.send_telegram({"text": "hi"})</function>
// The parser must turn this into a normal pseudo tool-call so the run-agent
// loop dispatches it. Tracked in spec/done/12-super-agent-empty-text-on-tool-loop.md.

test("extractPseudoToolCalls — Llama dotted-function wrapper, single", () => {
  const text = '<function.send_telegram({"text": "hola Manú"})</function>';
  const out = extractPseudoToolCalls(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].function.name, "send_telegram");
  assert.deepEqual(out[0].function.arguments, { text: "hola Manú" });
});

test("extractPseudoToolCalls — Llama dotted-function with empty args", () => {
  const text = "Voy a listar: <function.list_projects({})</function>";
  const out = extractPseudoToolCalls(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].function.name, "list_projects");
  assert.deepEqual(out[0].function.arguments, {});
});

test("extractPseudoToolCalls — Llama dotted-function, two consecutive", () => {
  const text =
    '<function.list_projects({})</function>\n' +
    '<function.send_telegram({"text": "done"})</function>';
  const out = extractPseudoToolCalls(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].function.name, "list_projects");
  assert.equal(out[1].function.name, "send_telegram");
});

test("extractPseudoToolCalls — Llama dotted-function tolerates missing closing tag", () => {
  // Model truncated; we still want to dispatch.
  const text = '<function.send_telegram({"text":"x"})';
  const out = extractPseudoToolCalls(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].function.name, "send_telegram");
});

test("extractPseudoToolCalls — does NOT double-fire JSON inside a dotted wrapper", () => {
  // The inner {"name":"x","arguments":{...}} JSON would otherwise also match
  // the second pass. Verify de-dup.
  const text = '<function.foo({"name":"trap","arguments":{"y":1}})</function>';
  const out = extractPseudoToolCalls(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].function.name, "foo");
});

test("cleanTextOfPseudoToolCalls — removes the Llama wrapper cleanly", () => {
  const text =
    "Voy a mandar el mensaje:\n" +
    '<function.send_telegram({"text": "ok"})</function>\n' +
    "Listo.";
  const cleaned = cleanTextOfPseudoToolCalls(text);
  // Nothing of the wrapper should remain.
  assert.equal(/function\./.test(cleaned), false);
  assert.equal(/<\/function>/.test(cleaned), false);
  // Surrounding prose is preserved.
  assert.match(cleaned, /Voy a mandar/);
  assert.match(cleaned, /Listo/);
});

test("cleanTextOfPseudoToolCalls — sweeps a stray </function> tag", () => {
  const text = "ya está listo</function>";
  const cleaned = cleanTextOfPseudoToolCalls(text);
  assert.equal(cleaned, "ya está listo");
});
