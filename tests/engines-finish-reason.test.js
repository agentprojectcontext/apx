// Guard: every adapter must report "I ran out of output budget" under the ONE
// field name the agent loop reads — `finish_reason`.
//
// WHY THIS FILE EXISTS. run-agent.js recovers from a reply cut off at the
// output cap (wasTruncated → TRUNCATED_SIGNAL → continue), and its comment
// claimed "every adapter passes the provider's own word through". Two did not:
//   • ollama.js   dropped `done_reason` entirely — nothing was passed through.
//   • anthropic.js passed it as `stop_reason`, a name the loop never reads.
// Both failures are silent and identical in shape: wasTruncated() returns
// false, the half-written reply is accepted as the final answer, and the turn
// ends mid-sentence. Seen live on 2026-09-12, when a project agent fell down
// the fallback chain to ollama:gemma4:31b-cloud and kept stopping on its first
// sentence with no error anywhere.
//
// The assertions run the REAL predicate, imported, so a change to what counts
// as truncated drags these tests along with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import ollama from "#core/engines/ollama.js";
import anthropic from "#core/engines/anthropic.js";
import { wasTruncated } from "#core/agent/run-agent.js";

/** A fetch stub whose non-streaming JSON body the caller supplies. */
function stubJson(payload) {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => payload });
  return () => { global.fetch = original; };
}

/** A fetch stub streaming `lines` as the response body, one chunk per line. */
function stubStream(lines) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    body: (async function* () {
      for (const l of lines) yield Buffer.from(`${l}\n`);
    })(),
  });
  return () => { global.fetch = original; };
}

const ask = [{ role: "user", content: "escribí algo largo" }];

test("ollama: done_reason 'length' arrives as finish_reason and reads as truncated", async () => {
  const restore = stubJson({
    message: { role: "assistant", content: "El mate es" },
    done_reason: "length",
    prompt_eval_count: 10,
    eval_count: 40,
  });
  try {
    const res = await ollama.chat({ model: "gemma4:31b-cloud", messages: ask, maxTokens: 40 });
    assert.equal(res.finish_reason, "length");
    assert.equal(wasTruncated(res), true);
  } finally { restore(); }
});

test("ollama: a reply that finished normally is NOT reported as truncated", async () => {
  const restore = stubJson({
    message: { role: "assistant", content: "listo" },
    done_reason: "stop",
    prompt_eval_count: 10,
    eval_count: 2,
  });
  try {
    const res = await ollama.chat({ model: "gemma4:31b-cloud", messages: ask });
    assert.equal(res.finish_reason, "stop");
    assert.equal(wasTruncated(res), false);
  } finally { restore(); }
});

test("ollama: the streaming path carries done_reason too", async () => {
  const restore = stubStream([
    JSON.stringify({ message: { content: "El mate " } }),
    JSON.stringify({ message: { content: "es" }, done: true, done_reason: "length", prompt_eval_count: 10, eval_count: 40 }),
  ]);
  try {
    let streamed = "";
    const res = await ollama.chat({
      model: "gemma4:31b-cloud", messages: ask, maxTokens: 40,
      onToken: (t) => { streamed += t; },
    });
    assert.equal(streamed, "El mate es");
    assert.equal(res.finish_reason, "length");
    assert.equal(wasTruncated(res), true);
  } finally { restore(); }
});

test("anthropic: stop_reason 'max_tokens' also arrives as finish_reason", async () => {
  const restore = stubJson({
    content: [{ type: "text", text: "El mate es" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 10, output_tokens: 40 },
  });
  try {
    const res = await anthropic.chat({
      model: "claude-sonnet-5", messages: ask, maxTokens: 40, config: { api_key: "test" },
    });
    assert.equal(res.finish_reason, "max_tokens");
    assert.equal(wasTruncated(res), true);
    // The provider's own word stays available under its own name.
    assert.equal(res.stop_reason, "max_tokens");
  } finally { restore(); }
});

test("anthropic: end_turn is not truncation", async () => {
  const restore = stubJson({
    content: [{ type: "text", text: "listo" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  try {
    const res = await anthropic.chat({
      model: "claude-sonnet-5", messages: ask, config: { api_key: "test" },
    });
    assert.equal(wasTruncated(res), false);
  } finally { restore(); }
});

test("anthropic: the streaming path carries stop_reason too", async () => {
  const restore = stubStream([
    `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } })}`,
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "El mate es" } })}`,
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 40 } })}`,
    "data: [DONE]",
  ]);
  try {
    let streamed = "";
    const res = await anthropic.chat({
      model: "claude-sonnet-5", messages: ask, maxTokens: 40, config: { api_key: "test" },
      onToken: (t) => { streamed += t; },
    });
    assert.equal(streamed, "El mate es");
    assert.equal(res.finish_reason, "max_tokens");
    assert.equal(wasTruncated(res), true);
  } finally { restore(); }
});
