import { http } from "../http";
import type { EngineSummary } from "../../types/daemon";

export interface EngineModels {
  engine: string;
  base_url?: string;
  models: string[];
  error?: string;
}

export interface EnginePreset {
  base_url: string;
  default_model: string;
  api_key_env: string;
  known_models: string[];
}

export interface EnginePresets {
  presets: Record<string, EnginePreset>;
}

export interface EngineTestResult {
  provider: string;
  model: string;
  text: string;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  ms: number;
}

export const Engines = {
  list: () => http.get<EngineSummary>("/api/engines"),
  // Curated catalog (known models + defaults) shared with the CLI wizard. The
  // source of truth is src/core/engines/presets.js.
  presets: () => http.get<EnginePresets>("/api/engines/presets"),
  // Live model catalog. api_key optional: falls back to the stored secret for
  // the provider slug (so editing an existing provider works without retyping).
  models: (body: { engine: string; slug?: string; base_url?: string; api_key?: string }) =>
    http.post<EngineModels>("/api/engines/models", body),
  // One-shot connectivity probe. Not a conversation: nothing is stored and the
  // daemon sends no history, tools or skills with it.
  test: (body: { provider: string; model: string; message?: string }) =>
    http.post<EngineTestResult>("/api/engines/test", body),
};
