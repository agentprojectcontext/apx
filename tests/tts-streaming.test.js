import { test } from "node:test";
import assert from "node:assert/strict";
import openai from "#core/voice/engines/openai.js";

const QVOX = {
  base_url: "http://127.0.0.1:5111/v1",
  language: "Spanish",
  clone: "/voices/alejandro.wav",
  ref_text: "La felicidad habita en el alma.",
  style: "A friendly Argentinian.",
};

test("streaming and file routes decide the same voice", () => {
  // The whole reason _request exists. If these drift, the same reply is read by
  // one voice through the desktop and another through a voice note, and nothing
  // in either path would say so.
  const args = { text: "Hola Manu.", config: QVOX, parentEnginesCfg: {} };
  const file = openai._request({ ...args, format: "wav" });
  const stream = openai._request({ ...args, format: "wav" });
  assert.equal(file.body.clone, stream.body.clone);
  assert.equal(file.body.ref_text, stream.body.ref_text);
  assert.equal(file.body.language, stream.body.language);
  assert.equal(file.body.instruct, stream.body.instruct);
});

test("a cloned voice carries its reference and what it says", () => {
  const { body, isCustom } = openai._request({
    text: "Hola.", config: QVOX, format: "wav", parentEnginesCfg: {},
  });
  assert.equal(isCustom, true);
  assert.equal(body.clone, "/voices/alejandro.wav");
  assert.equal(body.ref_text, "La felicidad habita en el alma.");
  assert.equal(body.language, "Spanish");
});

test("only a self-hosted endpoint claims to stream", () => {
  assert.equal(openai.canStream(QVOX), true);
  // Stock OpenAI: no base_url, no streaming route to call.
  assert.equal(openai.canStream({ api_key: "sk-test" }), false);
  // An operator can turn it off without unconfiguring the engine.
  assert.equal(openai.canStream({ ...QVOX, stream: false }), false);
});

test("streaming refuses an endpoint it cannot reach that way", async () => {
  await assert.rejects(
    () => openai.synthesizeStream({ text: "Hola.", config: { api_key: "sk-test" } }, () => {}),
    /self-hosted base_url/
  );
});

test("an empty request is refused before any network call", () => {
  assert.throws(() => openai._request({ text: "", config: QVOX }), /empty text/);
});
