// Transcription dialects: voice notes to text. "whisper-local" is the whisper server that runs on this Mac
// (faster-whisper or mlx-whisper) and reads the audio from a path; "openai-transcribe" uploads it to any
// OpenAI-compatible endpoint.
import { errorMessage } from "../errors.ts";
import { joinUrl, type ServiceConfig, ServiceError } from "./types.ts";

type Fetch = typeof fetch;

export type Audio = { path: string; bytes: Buffer; mime: string };

/** A minute of speech takes seconds on a local GPU; a stuck server must not hold a message forever. */
export const TRANSCRIBE_TIMEOUT_MS = 3 * 60_000;

async function whisperLocal(s: ServiceConfig, a: Audio, signal: AbortSignal, f: Fetch): Promise<string> {
  const res = await f(joinUrl(s.base_url, "/transcribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audio_path: a.path, ...(s.language ? { language: s.language } : {}) }),
    signal,
  });
  const j = (await res.json()) as { text?: string; error?: string };
  if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
  return (j.text ?? "").trim();
}

async function openaiTranscribe(s: ServiceConfig, a: Audio, key: string | undefined, signal: AbortSignal, f: Fetch) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(a.bytes)], { type: a.mime }), "voice.ogg");
  form.set("model", s.model || "whisper-1");
  if (s.language) form.set("language", s.language);
  const res = await f(joinUrl(s.base_url, "/v1/audio/transcriptions"), {
    method: "POST",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body: form,
    signal,
  });
  const j = (await res.json()) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  return (j.text ?? "").trim();
}

export async function transcribe(
  s: ServiceConfig,
  a: Audio,
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch = fetch,
): Promise<string> {
  const sig = AbortSignal.any([signal, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)]);
  try {
    if (s.dialect === "whisper-local") return await whisperLocal(s, a, sig, f);
    if (s.dialect === "openai-transcribe") return await openaiTranscribe(s, a, key, sig, f);
    throw new Error(`not a transcription service (${s.dialect})`);
  } catch (err) {
    throw new ServiceError(s.label, errorMessage(err));
  }
}

export const TRANSCRIBE_PROBE: Record<string, string> = {
  "whisper-local": "/health",
  "openai-transcribe": "/v1/models",
};
