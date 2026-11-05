import { useModels } from "../data/models.ts";
import { useData } from "../data/state.ts";

/** An engine session's engine as the owner knows it ("Claude Code", "Codex", "OpenCode"); none for an agent's chat. */
export function useEngineLabel(engine: string | undefined): string | undefined {
  const label = useData((s) => (engine ? s.engines.find((e) => e.id === engine)?.label : undefined));
  const catalogLabel = useModels((s) => (engine ? s.catalog.find((e) => e.id === engine)?.label : undefined));
  return engine ? (label ?? catalogLabel ?? engine) : undefined;
}
