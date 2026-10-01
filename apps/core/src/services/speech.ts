// Speech dialects. "openai-speech" covers OpenAI and every compatible server (QVox runs Qwen3-TTS on the Mac's GPU at
// http://127.0.0.1:5111/v1; Pocket TTS…): QVox also takes a style instruction and a language. Gemini returns raw
// 16-bit PCM, which is wrapped in a WAV header here.
import {
  joinUrl,
  PROBE_TIMEOUT_MS,
  type ServiceConfig,
  ServiceError,
  SPEECH_TIMEOUT_MS,
  type SpeechResult,
} from "./types.ts";

type Fetch = typeof fetch;

export type SpeechRequest = { text: string; voice?: string | undefined; style?: string | undefined };

async function openaiSpeech(
  s: ServiceConfig,
  r: SpeechRequest,
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch,
) {
  const stock = /api\.openai\.com/.test(s.base_url);
  const voice = r.voice ?? s.voice;
  const style = r.style ?? s.style;
  const res = await f(joinUrl(s.base_url, "/v1/audio/speech"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}`, "x-api-key": key } : {}),
    },
    body: JSON.stringify({
      input: r.text,
      response_format: stock ? "mp3" : "wav",
      ...(s.model ? { model: s.model } : stock ? { model: "tts-1" } : {}),
      ...(voice ? { voice } : stock ? { voice: "alloy" } : {}),
      // OpenAI's gpt-4o voices read `instructions`; QVox reads `instruct` and `language`.
      ...(style ? (stock ? { instructions: style } : { instruct: style }) : {}),
      ...(!stock && s.language ? { language: s.language } : {}),
      ...(!stock && s.clone ? { clone: s.clone, ...(s.ref_text ? { ref_text: s.ref_text } : {}) } : {}),
      ...(!stock && s.temperature !== undefined ? { temperature: s.temperature } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, mime: res.headers.get("content-type")?.split(";")[0] || (stock ? "audio/mpeg" : "audio/wav") };
}

/** A WAV header for mono 16-bit PCM. */
function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function geminiSpeech(
  s: ServiceConfig,
  r: SpeechRequest,
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch,
) {
  if (!key) throw new Error("needs a Gemini API key");
  const model = s.model || "gemini-2.5-flash-preview-tts";
  const style = r.style ?? s.style;
  // The key goes in a header, never in the URL (URLs end up in logs).
  const res = await f(joinUrl(s.base_url, `/v1beta/models/${encodeURIComponent(model)}:generateContent`), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: style ? `${style}: ${r.text}` : r.text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: r.voice ?? s.voice ?? "Kore" } } },
      },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!part?.data) throw new Error("no audio came back");
  const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24_000);
  return { bytes: wav(Buffer.from(part.data, "base64"), rate), mime: "audio/wav" };
}

const DIALECTS = { "openai-speech": openaiSpeech, "gemini-speech": geminiSpeech } as const;

export async function speak(
  s: ServiceConfig,
  r: SpeechRequest,
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch = fetch,
): Promise<SpeechResult> {
  const dialect = DIALECTS[s.dialect as keyof typeof DIALECTS];
  if (!dialect) throw new ServiceError(s.label, `not a speech service (${s.dialect})`);
  try {
    return await dialect(s, r, key, AbortSignal.any([signal, AbortSignal.timeout(SPEECH_TIMEOUT_MS)]), f);
  } catch (err) {
    throw new ServiceError(s.label, err instanceof Error ? err.message : String(err));
  }
}

export const SPEECH_PROBE: Record<string, string> = {
  "openai-speech": "/v1/models",
  "gemini-speech": "/v1beta/models",
};

export { PROBE_TIMEOUT_MS };
