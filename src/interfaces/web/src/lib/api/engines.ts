import { http } from "../http";
import type { EngineSummary } from "../../types/daemon";

export interface EngineModels {
  engine: string;
  base_url?: string;
  models: string[];
  error?: string;
}

export const Engines = {
  list: () => http.get<EngineSummary>("/engines"),
  // Live model catalog. api_key optional: falls back to the stored secret for
  // the provider slug (so editing an existing provider works without retyping).
  models: (body: { engine: string; slug?: string; base_url?: string; api_key?: string }) =>
    http.post<EngineModels>("/engines/models", body),
};
