import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribe, uploadName } from "./transcription.ts";

test("an OpenAI-compatible server gets the audio under a name with its own format's extension", async () => {
  const names: string[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const file = (init.body as FormData).get("file") as File;
    names.push(file.name);
    return new Response(JSON.stringify({ text: " hola " }), { status: 200 });
  }) as typeof fetch;
  const s = {
    id: "cloud",
    kind: "transcription",
    dialect: "openai-transcribe",
    label: "Cloud",
    base_url: "https://api.example.com",
    enabled: true,
    needs_key: true,
  } as const;
  const said = await transcribe(
    s,
    { path: "", bytes: Buffer.alloc(8), mime: "audio/wav" },
    undefined,
    AbortSignal.timeout(5000),
    f,
  );
  assert.equal(said, "hola");
  assert.deepEqual(names, ["voice.wav"]);
  assert.equal(uploadName("audio/webm;codecs=opus"), "voice.webm");
  assert.equal(uploadName("audio/unknown"), "voice.ogg");
});
