import { http, getToken } from "../http";

// Voice / TTS / STT client. Talks to the daemon's /voice, /tts and /transcribe
// surfaces (see src/host/daemon/api/{voice,tts,transcribe}.js + the engine
// registry at src/core/voice/engines/index.js).
//
// TTS engine ids (preference order, "auto" picks the first available):
//   piper → elevenlabs → openai → gemini → mock
//
// Per-engine config lives under config.voice.tts.<id>; the default provider is
// config.voice.tts.provider. STT config lives under config.transcription.

// ── TTS provider catalog (GET /tts/providers) ──────────────────────────────

export type TtsProviderId = "piper" | "elevenlabs" | "openai" | "gemini" | "mock";

export type TtsMode = "chain" | "single";

/** One engine entry as reported by /tts/providers. */
export interface TtsEngineInfo {
  id: string;
  available: boolean;   // probe says it can synthesize right now
  configured: boolean;  // has a non-empty voice.tts.<id> config block
  enabled: boolean;     // included in the fallback chain (voice.tts.<id>.enabled)
}

export interface TtsProvidersResponse {
  configured_provider: string; // "auto" | <engine id> (the single-mode default)
  mode: TtsMode;               // "chain" (router) | "single" (only the default)
  order: string[];             // effective chain order (custom + defaults)
  engines: TtsEngineInfo[];
}

// ── /tts/say + /voice/turn result shapes ────────────────────────────────────

export interface TtsSayResult {
  audio_path: string;       // absolute path under ~/.apx/tmp/tts
  duration_s: number | null;
  mime: string | null;
  provider: string;         // engine that actually synthesized
}

export interface VoiceTurnResult {
  user_text: string;
  reply_text: string;
  reply_audio_path: string | null;
  reply_duration_s?: number | null;
  reply_mime?: string | null;
  provider: string | null;
  tts_error?: string;
  empty?: boolean;
}

// ── Config shapes (config.voice.tts.* / config.transcription.*) ─────────────
// These mirror the engine adapters. Kept local to the Voices module (per the
// task: shared types live here, not in types/daemon.ts).

export interface PiperConfig {
  bin?: string;
  model?: string;       // abs path to <voice>.onnx
  speaker?: string | number;
  extra_args?: string[];
}
export interface ElevenLabsConfig {
  api_key?: string;
  model?: string;       // eleven_multilingual_v2
  voice_id?: string;
  output_format?: string;
}
export interface OpenAiTtsConfig {
  api_key?: string;
  model?: string;       // tts-1 | tts-1-hd
  voice?: string;       // alloy | echo | fable | onyx | nova | shimmer
  format?: string;      // mp3 | opus | aac | flac | wav
}
export interface GeminiTtsConfig {
  api_key?: string;
  model?: string;       // gemini-2.5-flash-preview-tts
  voice?: string;       // e.g. Kore
  style?: string;       // natural-language speaking-style instruction
  enabled?: boolean;
}

export interface VoiceTtsConfig {
  provider?: string;    // "auto" | engine id (single-mode default)
  mode?: TtsMode;       // "chain" | "single"
  order?: string[];     // custom engine order for chain mode
  piper?: PiperConfig;
  elevenlabs?: ElevenLabsConfig;
  openai?: OpenAiTtsConfig;
  gemini?: GeminiTtsConfig;
}

export interface TranscriptionLocalConfig {
  model?: string;        // tiny | base | small | medium | large | large-v2 | large-v3
  device?: string;       // cpu | cuda
  compute_type?: string; // int8 | int8_float16 | float16 | float32
  language?: string;     // ISO code or "auto"
  beam_size?: number;
  idle_minutes?: number;
}
export interface TranscriptionOpenAIConfig {
  base_url?: string;     // defaults to https://api.openai.com/v1
  api_key?: string;      // may carry a redacted "*** set ***" marker
  model?: string;        // defaults to whisper-1
}
export interface TranscriptionCustomConfig {
  base_url?: string;     // OpenAI-compatible server, e.g. http://localhost:8000/v1
  api_key?: string;      // optional; may carry a redacted marker
  model?: string;        // e.g. mlx-community/whisper-large-v3-turbo
  language?: string;     // ISO code or "auto"
}
export interface TranscriptionConfig {
  provider?: string;     // "auto" | "local" | "openai" | "custom"
  local?: TranscriptionLocalConfig;
  openai?: TranscriptionOpenAIConfig;
  custom?: TranscriptionCustomConfig;
}

/** One STT engine entry as reported by GET /transcribe/providers. */
export interface SttProviderEntry {
  id: string;             // "local" | "openai" | "custom"
  available: boolean;
  configured: boolean;
}
export interface SttProvidersResponse {
  configured_provider: string;
  engines: SttProviderEntry[];
}

// Known engine voice presets used to fill selects without a daemon round-trip.
export const OPENAI_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"];
export const ELEVENLABS_MODELS = ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"];
export const OPENAI_TTS_MODELS = ["tts-1", "tts-1-hd"];
export const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v2", "large-v3", "large-v3-turbo"];

// Friendly labels + ordering for the provider list. The daemon is the source
// of truth for availability; this only adds display names + a stable order.
export const TTS_PROVIDER_META: Record<string, { name: string; note: string; local?: boolean }> = {
  piper:      { name: "Piper",       note: "Local, offline (CLI + .onnx model). No API key.", local: true },
  elevenlabs: { name: "ElevenLabs",  note: "Cloud, multilingual. Requires an API key." },
  openai:     { name: "OpenAI",      note: "Cloud (tts-1 / tts-1-hd). Uses your OpenAI key." },
  gemini:     { name: "Gemini",      note: "Cloud (preview). Uses your Gemini key." },
  mock:       { name: "Mock",        note: "Silent test engine. Always available as a fallback.", local: true },
};

export const TTS_PROVIDER_ORDER: TtsProviderId[] = ["piper", "elevenlabs", "openai", "gemini", "mock"];

/**
 * Build an authenticated blob URL for a TTS audio file produced by /tts/say
 * or /voice/turn. The daemon sandboxes /voice/tts to ~/.apx/tmp/tts, so the
 * caller just passes the absolute audio_path it got back.
 */
export async function fetchTtsAudioUrl(audioPath: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/voice/tts?path=${encodeURIComponent(audioPath)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`No se pudo leer el audio (${res.status}): ${detail.slice(0, 160)}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const Voice = {
  /** List TTS engines + availability + the configured default provider. */
  providers: () => http.get<TtsProvidersResponse>("/tts/providers"),

  /**
   * Synthesize speech. Returns the audio file path (server-side); the web
   * fetches it via fetchTtsAudioUrl() to play it in the browser. `no_play`
   * is irrelevant for the web (the daemon never plays for HTTP callers).
   */
  say: (body: { text: string; provider?: string; voice?: string; language?: string; format?: string; style?: string }) =>
    http.post<TtsSayResult>("/tts/say", body),

  /**
   * One bidirectional voice turn (STT → agent → TTS). The web uses the
   * text-only path (pass `text`) to test the full reply pipeline without a mic.
   */
  turn: (body: {
    text?: string;
    audio?: string;
    format?: string;
    channel?: string;
    provider?: string;
    voice?: string;
    language?: string;
  }) => http.post<VoiceTurnResult>("/voice/turn", body),
};
