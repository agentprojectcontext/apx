import assert from "node:assert/strict";
import { test } from "node:test";
import { missingPinned, PINNED } from "./pinned.ts";

// Gemini's list once its 2.5 preview voices were shut down (ids as its models endpoint gives them).
const GEMINI_AFTER_TTS_SHUTDOWN = [
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-embedding-001",
  "gemini-embedding-2",
].map((id) => ({ id }));

test("a voice default the provider stopped listing is reported", () => {
  const retired = { provider: "gemini", id: "gemini-2.5-flash-preview-tts", use: "speech", source: "x" } as const;
  assert.deepEqual(missingPinned({ gemini: GEMINI_AFTER_TTS_SHUTDOWN }, [retired, PINNED.geminiSpeech]), [retired]);
});

test("today's Gemini defaults are in its list; a provider not read says nothing", () => {
  assert.deepEqual(missingPinned({ gemini: GEMINI_AFTER_TTS_SHUTDOWN }), []);
  assert.deepEqual(
    missingPinned({ openai: [] })
      .map((p) => p.id)
      .sort(),
    ["text-embedding-3-small", "tts-1", "whisper-1"],
  );
});
