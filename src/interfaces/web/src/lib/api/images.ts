import { http, getToken } from "../http";
import { apiUrl } from "../net";

// Image-generation client. Talks to the daemon's /images surface (see
// src/host/daemon/api/images.js + the engine registry at
// src/core/images/engines/index.js).
//
// Engine ids (chain order, "auto" takes the first reachable one):
//   a1111 → sdcpp → openai → mock
//
// Per-engine config lives under config.images.<id>; user-added endpoints under
// config.images.custom.<slug>, each naming the dialect it speaks in `kind`.
// Shared defaults (size, steps, cfg…) live under config.images.defaults and are
// overridden per engine by config.images.<id>.defaults.

export type ImageEngineId = "a1111" | "sdcpp" | "openai" | "mock";
export type ImageMode = "chain" | "single";
/** Which dialect a custom endpoint speaks — it decides the adapter. */
export type ImageCustomKind = "a1111" | "sdcpp" | "openai";

export const IMAGE_CUSTOM_KINDS: ImageCustomKind[] = ["a1111", "sdcpp", "openai"];

/** One engine as reported by /images/providers. */
export interface ImageEngineInfo {
  id: string;
  available: boolean;   // the probe reached it just now
  configured: boolean;  // has a non-empty images.<id> block
  enabled: boolean;     // included in the chain (images.<id>.enabled)
  supports: string[];   // knobs this engine can actually honor
  note?: string;        // usually the base_url
  custom?: boolean;     // user-added ("custom:<slug>")
  kind?: ImageCustomKind;
  label?: string;
}

export interface ImageDefaults {
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  seed: number;
  count: number;
  format: string;
  negative_prompt: string;
  sampler: string;
  scheduler: string;
}

export interface ImageProvidersResponse {
  configured_provider: string; // "auto" | engine id
  mode: ImageMode;
  order: string[];
  defaults: ImageDefaults;
  engines: ImageEngineInfo[];
}

/** What a server says it can do. Every field is optional — many have none. */
export interface ImageCapabilities {
  models?: string[];
  samplers?: string[];
  schedulers?: string[];
  formats?: string[];
  sizes?: string[];
  defaults?: { width?: number; height?: number } | null;
  modes?: string[];
}

export interface ImageCapabilitiesResponse {
  provider: string;
  capabilities: ImageCapabilities | null;
}

export interface GeneratedImage {
  path: string;      // absolute, under ~/.apx/images/<date>/
  url: string;       // /api/images/file?path=… — fetch it with the bearer
  bytes: number;
  mime: string;
  format: string;
  seed?: number | null;
}

export interface ImageGenerateResult {
  images: GeneratedImage[];
  provider: string;
  model: string | null;
  prompt: string;
  request: Partial<ImageDefaults> & { model?: string };
  /** Knobs this engine could not honor — shown so a silent drop never happens. */
  ignored: string[];
  elapsed_ms: number;
  meta: Record<string, unknown>;
}

export interface ImageGenerateBody {
  prompt: string;
  provider?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  size?: string;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  count?: number;
  format?: string;
  model?: string;
}

/** Per-engine config block (images.<id> / images.custom.<slug>). */
export interface ImageEngineConfig {
  base_url?: string;
  api_key?: string;      // may carry a redacted "*** set ***" marker
  model?: string;
  enabled?: boolean;
  timeout_s?: number;
  poll_interval_ms?: number;
  size?: string;         // openai only
  quality?: string;      // openai only
  label?: string;        // custom only
  kind?: ImageCustomKind; // custom only
  defaults?: Partial<ImageDefaults> & { size?: string };
}

export interface ImagesConfig {
  provider?: string;
  mode?: ImageMode;
  order?: string[];
  defaults?: Partial<ImageDefaults> & { size?: string };
  a1111?: ImageEngineConfig;
  sdcpp?: ImageEngineConfig;
  openai?: ImageEngineConfig;
  custom?: Record<string, ImageEngineConfig>;
}

// Display names and the one-line "what is this" under each row. The daemon
// owns availability; this only adds names and notes.
export const IMAGE_PROVIDER_META: Record<string, { name: string; note: string; local?: boolean }> = {
  a1111: {
    name: "AUTOMATIC1111 API",
    note: "The universal dialect: A1111, Forge, SD.Next, Draw Things on macOS, stable-diffusion.cpp. Set a base URL — no API key needed for a local or LAN server.",
    local: true,
  },
  sdcpp: {
    name: "stable-diffusion.cpp",
    note: "The same server's native queue: it answers immediately and the job is polled, so a long render never holds a connection open.",
    local: true,
  },
  openai: {
    name: "OpenAI Images",
    note: "Cloud (gpt-image-1 / dall-e-3), or any OpenAI-compatible /v1/images endpoint if you set a base URL. This dialect has no steps, cfg or negative prompt.",
  },
  mock: {
    name: "Mock",
    note: "Offline test engine. Always available as the last rung of the chain.",
    local: true,
  },
};

export const IMAGE_FORMATS = ["png", "jpeg", "webp"];
export const IMAGE_SIZE_PRESETS = ["512x512", "768x512", "512x768", "1024x1024", "1024x576"];

/**
 * Build a blob URL for a generated image. The file route is authenticated and
 * sandboxed to ~/.apx/images, so the browser cannot just point an <img> at it.
 */
export async function fetchImageBlobUrl(imagePath: string): Promise<string> {
  const token = getToken();
  const res = await fetch(apiUrl(`/api/images/file?path=${encodeURIComponent(imagePath)}`), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${detail.slice(0, 160)}`);
  }
  return URL.createObjectURL(await res.blob());
}

export const Images = {
  /** Engines, availability, routing and the effective defaults. */
  providers: () => http.get<ImageProvidersResponse>("/api/images/providers"),

  /** What one server offers (models, samplers, schedulers). May be null. */
  capabilities: (provider?: string) =>
    http.get<ImageCapabilitiesResponse>(
      `/api/images/capabilities${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
    ),

  /** Generate. The reply carries file paths plus authenticated urls. */
  generate: (body: ImageGenerateBody) =>
    http.post<ImageGenerateResult>("/api/images/generate", body),
};
