// Memory's embedding engine on this machine, from the app: Ollama's models, the one that fits, pulling it (see
// local-embed.ts).

import os from "node:os";
import type { LocalEmbedding } from "@apx/protocol";
import { badRequest, errorMessage } from "../errors.ts";
import { EMBED_MODELS, type LocalEmbeddings, recommendEmbedder } from "../services/local-embed.ts";
import type { Services } from "../services/registry.ts";
import type { Handlers } from "./router.ts";

/** The service the setup sets up; the owner may add other embedding services by hand. */
export const LOCAL_EMBED_SERVICE = "local-ollama-embed";

/** Ollama here with this model becomes memory's embedding engine, tried first; the rest keep their order after it. */
export function useLocalEmbedder(services: Services, url: string, model: string): void {
  services.set(LOCAL_EMBED_SERVICE, {
    kind: "embedding",
    dialect: "ollama-embed",
    label: "Ollama (local)",
    base_url: url,
    enabled: true,
    needs_key: false,
    model,
  });
  services.order("embedding", [LOCAL_EMBED_SERVICE]);
}

export function embeddingHandlers(local: LocalEmbeddings, engine: () => string | undefined) {
  const status = async (): Promise<LocalEmbedding> => {
    const memory = os.totalmem() / 2 ** 30;
    const pull = local.progress();
    const active = engine();
    return {
      memory_gb: Math.round(memory),
      ollama: await local.state(),
      library: EMBED_MODELS.map((m) => ({ ...m })),
      recommended: recommendEmbedder(memory),
      ...(pull ? { pull } : {}),
      ...(active ? { active } : {}),
    };
  };
  return {
    "embeddings.local": () => status(),
    "embeddings.install": async ({ model }) => {
      try {
        await local.install(model);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return status();
    },
  } satisfies Partial<Handlers>;
}
