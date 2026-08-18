// One line, written by the model instead of stored as copy.
//
// The contract this pins is narrow on purpose: authorLine is only ever called
// where the caller ALREADY has a floor to fall back on, so every failure mode —
// no model configured, engine down, timeout, an answer that is all thinking and
// no words — has to come back as "" instead of throwing. A caller that has to
// wrap it in a try/catch would be a caller that can end up silent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorLine } from "#core/agent/author-line.js";

const CFG = { super_agent: { model: "mock:test" } };

test("authorLine: returns the model's line", async () => {
  const line = await authorLine({
    globalConfig: CFG,
    instruction: "Close the turn.",
    callEngineFn: async () => ({ text: "Listo, quedó andando." }),
  });
  assert.equal(line, "Listo, quedó andando.");
});

test("authorLine: the instruction, the context and the language reach the model", async () => {
  let seen = null;
  await authorLine({
    globalConfig: CFG,
    instruction: "Close the turn.",
    context: "What you did this turn: read_file×3",
    lang: "es",
    callEngineFn: async (o) => { seen = o; return { text: "ok" }; },
  });
  const content = seen.messages[0].content;
  assert.match(content, /Close the turn\./);
  assert.match(content, /read_file×3/, "the line has to be written from what happened");
  assert.match(content, /\bes\b/, "the language hint travels with it");
  assert.equal(seen.modelId, "mock:test");
  assert.equal(seen.tools, undefined, "not a turn: no tools are offered");
});

test("authorLine: writes in the most specific tag the config has", async () => {
  const ask = async (user, lang) => {
    let seen = null;
    await authorLine({
      globalConfig: { ...CFG, user },
      instruction: "x",
      ...(lang ? { lang } : {}),
      callEngineFn: async (o) => { seen = o; return { text: "ok" }; },
    });
    return seen.messages[0].content;
  };

  // "es" answers in neutral Spanish, "es-AR" answers in voseo — the locale is
  // the difference between the agent's voice and a translation of it.
  assert.match(await ask({ language: "es", locale: "es-AR" }), /es-AR/);
  assert.match(await ask({ language: "es" }), /\bes\b/, "language alone still travels");
  assert.match(await ask({ language: "es", locale: "es-AR" }, "pt-BR"), /pt-BR/, "an explicit tag wins");
  assert.doesNotMatch(await ask({}), /BCP-47/, "nothing configured, nothing claimed");
});

test("authorLine: strips the wrapper a model puts around a line", async () => {
  const cases = [
    ['"Ya está, ¿seguimos?"', "Ya está, ¿seguimos?"],
    ["```\nYa está\n```", "Ya está"],
    ["<think>the user asked to reset</think>Listo, arrancamos de nuevo.", "Listo, arrancamos de nuevo."],
    ["  Listo.  ", "Listo."],
  ];
  for (const [raw, want] of cases) {
    const got = await authorLine({
      globalConfig: CFG,
      instruction: "x",
      callEngineFn: async () => ({ text: raw }),
    });
    assert.equal(got, want, `cleaning ${JSON.stringify(raw)}`);
  }
});

test("authorLine: every failure is an empty string, never a throw", async () => {
  const engineDown = await authorLine({
    globalConfig: CFG,
    instruction: "x",
    callEngineFn: async () => { throw new Error("connect ECONNREFUSED"); },
  });
  assert.equal(engineDown, "", "an engine that is down is exactly when the floor is needed");

  const allThinking = await authorLine({
    globalConfig: CFG,
    instruction: "x",
    callEngineFn: async () => ({ text: "<think>hmm</think>" }),
  });
  assert.equal(allThinking, "", "reasoning is not a line");

  const empty = await authorLine({
    globalConfig: CFG,
    instruction: "x",
    callEngineFn: async () => ({ text: "" }),
  });
  assert.equal(empty, "");
});

test("authorLine: no model, no instruction — no call at all", async () => {
  let called = false;
  const spy = async () => { called = true; return { text: "hi" }; };

  assert.equal(await authorLine({ globalConfig: {}, instruction: "x", callEngineFn: spy }), "");
  assert.equal(await authorLine({ globalConfig: CFG, instruction: "", callEngineFn: spy }), "");
  assert.equal(called, false, "nothing to say and nothing to say it with — don't pay for a call");
});

test("authorLine: the caller's abort is honoured", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const line = await authorLine({
    globalConfig: CFG,
    instruction: "x",
    signal: ctrl.signal,
    callEngineFn: async (o) => {
      o.signal.throwIfAborted();
      return { text: "should not get here" };
    },
  });
  assert.equal(line, "");
});
