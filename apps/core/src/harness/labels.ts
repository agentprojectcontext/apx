import type { Store } from "../domain/store.ts";
import { acpAgents, acpEngine } from "./acp/agents.ts";
import { ONESHOT } from "./oneshot.ts";

const CLI_LABELS: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

/** An outside engine as the owner knows it ("Claude Code", "OpenCode"); an unknown one keeps its id. */
export function engineLabel(store: Store, engine: string): string {
  return (
    CLI_LABELS[engine] ??
    (engine in ONESHOT ? ONESHOT[engine as keyof typeof ONESHOT].label : undefined) ??
    acpAgents(store).find((a) => acpEngine(a) === engine)?.label ??
    engine
  );
}
