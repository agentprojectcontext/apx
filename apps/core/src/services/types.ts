// Media services the owner runs or uses: image generators (a homelab's A1111 or stable-diffusion.cpp, an
// OpenAI-compatible API) and voices (QVox or any OpenAI-compatible speech server, Gemini). Each service speaks one
// dialect; the registry keeps them in the owner's order and the first reachable one answers.
import type { ServiceSettings } from "@apx/protocol";

/** A service as the owner configured it (the protocol's settings plus its id). The key lives in the secret store. */
export type ServiceConfig = ServiceSettings & { id: string };

export type ImageOptions = {
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  seed: number;
  count: number;
  negative_prompt: string;
  sampler: string;
};

export type GeneratedImage = { bytes: Buffer; mime: string; seed?: number | undefined };

export type ImageResult = { images: GeneratedImage[]; model?: string | undefined };

export type SpeechResult = { bytes: Buffer; mime: string };

/** What a call may take before it is cut: a GPU queue is slow, a hung server must not hold a turn forever. */
export const IMAGE_TIMEOUT_MS = 10 * 60_000;
export const SPEECH_TIMEOUT_MS = 90_000;
export const PROBE_TIMEOUT_MS = 2000;

export class ServiceError extends Error {
  readonly service: string;
  constructor(service: string, message: string) {
    super(`${service}: ${message}`);
    this.name = "ServiceError";
    this.service = service;
  }
}

/** Joins a base URL and a path without doubling "/v1" or slashes. */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return b.endsWith("/v1") && p.startsWith("/v1/") ? `${b}${p.slice(3)}` : `${b}${p}`;
}

/** The kind of image the bytes are, from their first bytes (servers do not always say). */
export function sniffImage(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "application/octet-stream";
}
