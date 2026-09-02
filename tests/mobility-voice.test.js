// Telegram replies while the owner is driving: spoken first, transcript
// second, and short because the TURN ran in voice mode — not because anything
// truncated it afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobility-voice-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { deliverVoiceReply, mobilityVoiceActive } =
  await import("../src/core/channels/telegram/voice-note.js");
const { _resetMobilityStateForTest, observeMobilityEvent } =
  await import("../src/core/mobility/state.js");
const { buildMobilityModeBlock } = await import("../src/core/agent/prompt-builder.js");
const { buildSuperAgentSystem } = await import("../src/core/agent/prompt-builder.js");

test.beforeEach(() => _resetMobilityStateForTest());
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function startTrip() {
  observeMobilityEvent({ type: "trip.started", trip_id: "trip-voice", destination: "Onelli 444" });
}

/** A synthesizer that writes real bytes, so the cleanup path is exercised. */
function fakeSynth(provider = "qvox") {
  return async () => {
    const file = path.join(tmpHome, `speech-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(file, Buffer.alloc(64));
    return { audio_path: file, duration_s: 4.2, mime: "audio/wav", provider };
  };
}

function fakeConvert() {
  return async (source) => {
    const target = source.replace(/\.wav$/, ".ogg");
    fs.writeFileSync(target, Buffer.alloc(48));
    return target;
  };
}

function recordingIo() {
  const sent = [];
  return {
    sent,
    send: async (args) => { sent.push({ kind: "text", ...args }); return { message_id: sent.length }; },
    sendVoice: async (args) => { sent.push({ kind: "voice", ...args }); return { message_id: sent.length }; },
  };
}

test("voice replies are on while a trip is active and off once it ends", () => {
  assert.equal(mobilityVoiceActive({}), false);
  startTrip();
  assert.equal(mobilityVoiceActive({}), true);
  // The owner can turn the whole behaviour off without ending the trip.
  assert.equal(mobilityVoiceActive({ voice: { mobility_replies: false } }), false);
  observeMobilityEvent({ type: "trip.ended", trip_id: "trip-voice" });
  assert.equal(mobilityVoiceActive({}), false);
});

test("a driving reply goes out as a voice note AND a flagged transcript", async () => {
  startTrip();
  const io = recordingIo();
  const result = await deliverVoiceReply({
    io,
    chat_id: 1234567890,
    text: "Listo, anoté la tarea.",
    globalConfig: { user: { language: "es" } },
    synthesizeFn: fakeSynth(),
    toVoiceNoteFn: fakeConvert(),
  });

  assert.equal(result.voice, true);
  assert.equal(io.sent.length, 2, "two sends: the audio, then the text under it");
  assert.equal(io.sent[0].kind, "voice");
  assert.equal(io.sent[0].duration, 4);
  assert.match(io.sent[0].audio, /\.ogg$/, "Telegram only renders OGG/Opus as a voice note");
  assert.equal(io.sent[1].kind, "text");
  assert.match(io.sent[1].text, /^📝 Transcripción del audio:/, "the text half must say it is a transcript");
  assert.match(io.sent[1].text, /Listo, anoté la tarea\./, "and must carry the same words");
});

test("the chips ride on the transcript, never on the audio player", async () => {
  startTrip();
  const io = recordingIo();
  const reply_markup = { inline_keyboard: [[{ text: "✅ Voy", callback_data: "apx:mobility:go:mb1" }]] };
  await deliverVoiceReply({
    io,
    chat_id: 1234567890,
    text: "Estás cerca de la farmacia.",
    reply_markup,
    globalConfig: { user: { language: "es" } },
    synthesizeFn: fakeSynth(),
    toVoiceNoteFn: fakeConvert(),
  });
  assert.equal(io.sent[0].reply_markup, undefined);
  assert.deepEqual(io.sent[1].reply_markup, reply_markup);
});

test("silence is not a spoken reply — the mock engine falls back to text", async () => {
  startTrip();
  const io = recordingIo();
  const result = await deliverVoiceReply({
    io,
    chat_id: 1234567890,
    text: "Listo.",
    globalConfig: {},
    synthesizeFn: fakeSynth("mock"),
    toVoiceNoteFn: fakeConvert(),
  });
  assert.equal(result.voice, false);
  assert.equal(result.reason, "tts:mock");
  assert.equal(io.sent.length, 0, "the caller owes the text send, not this function");
});

test("a failed conversion loses the audio, never the message", async () => {
  startTrip();
  const io = recordingIo();
  const result = await deliverVoiceReply({
    io,
    chat_id: 1234567890,
    text: "Listo.",
    globalConfig: {},
    synthesizeFn: fakeSynth(),
    toVoiceNoteFn: async () => null,
  });
  assert.equal(result.voice, false);
  assert.equal(result.reason, "ffmpeg");
  assert.equal(io.sent.length, 0);
});

test("temporary speech files do not survive the send", async () => {
  startTrip();
  const before = fs.readdirSync(tmpHome).filter((f) => /^speech-/.test(f));
  await deliverVoiceReply({
    io: recordingIo(),
    chat_id: 1234567890,
    text: "Listo.",
    globalConfig: {},
    synthesizeFn: fakeSynth(),
    toVoiceNoteFn: fakeConvert(),
  });
  const after = fs.readdirSync(tmpHome).filter((f) => /^speech-/.test(f));
  assert.deepEqual(after, before, "both the wav and the ogg are cleaned up");
});

test("mobility mode teaches the model to answer in one or two spoken sentences", () => {
  assert.equal(buildMobilityModeBlock(false), "");
  const block = buildMobilityModeBlock(true);
  assert.match(block, /ONE or TWO short sentences/);
  assert.match(block, /voice note/);

  // And it reaches the assembled prompt only when the turn declares it.
  const system = buildSuperAgentSystem({
    globalConfig: { super_agent: {} },
    projects: { list: () => [] },
    listSkills: () => [],
    channel: "telegram",
    channelMeta: { voice: true, mobility: true },
  });
  assert.match(system, /Mobility mode/);
  const parked = buildSuperAgentSystem({
    globalConfig: { super_agent: {} },
    projects: { list: () => [] },
    listSkills: () => [],
    channel: "telegram",
    channelMeta: {},
  });
  assert.doesNotMatch(parked, /Mobility mode/);
});
