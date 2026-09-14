import { useProviderModels, type ProviderModels } from "./useProviderModels";

// Ollama's slice of the shared provider catalog (see ./useProviderModels).
//
// It used to own its own fetch + cache because it was the only engine we probed
// live. It is not any more — every active provider is probed the same way, and
// two copies of "ask the daemon, fall back to the last list we saw" is two
// places for the answer to drift. The Ollama-shaped signature stays because the
// router screens ask an Ollama-shaped question: which models does THIS box
// have, and did it answer at all.

export interface OllamaProbeTarget { slug: string; base_url?: string }

/**
 * Probe every Ollama provider once per changed target set. Returns its live
 * model list plus whether the server actually answered, so callers can both
 * populate a dropdown and tell "connected" from "configured".
 */
export function useOllamaModels(targets: OllamaProbeTarget[]): ProviderModels {
  return useProviderModels(targets.map((t) => ({ slug: t.slug, engine: "ollama", base_url: t.base_url })));
}
