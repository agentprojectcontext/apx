import { http } from "../http";

// RAG embeddings client. Talks to the daemon's /embeddings surface
// (src/host/daemon/api/embeddings.js + the engine registry at
// src/core/memory/embed-engines/index.js). Mirrors the TTS/STT pattern: pick a
// provider + model per section, config persists under config.memory.embeddings.

export type EmbedProviderId = "ollama" | "openai" | "gemini" | "tf";
export type EmbedMode = "chain" | "single";

export interface EmbedEngineInfo {
  id: string;
  available: boolean;   // probe says it can embed right now
  configured: boolean;  // has a non-empty memory.embeddings.<id> config block
  enabled: boolean;     // included in the fallback chain
}

export interface EmbedProvidersResponse {
  configured_provider: string; // "auto" | <engine id>
  mode: EmbedMode;
  order: string[];
  engines: EmbedEngineInfo[];
}

export interface EmbedTestResult {
  ok: boolean;
  provider: string;
  embedder: string;  // e.g. "ollama:nomic-embed-text" | "openai:text-embedding-3-small" | "tf"
  dim: number;
  ms: number;
}

export interface EmbedReindexResult {
  ok: boolean;
  cleared: number;
  indexed: number;
}

export const Embeddings = {
  providers: () => http.get<EmbedProvidersResponse>("/embeddings/providers"),
  test: (body: { text?: string; provider?: string } = {}) =>
    http.post<EmbedTestResult>("/embeddings/test", body),
  reindex: () => http.post<EmbedReindexResult>("/embeddings/reindex", {}),
};
