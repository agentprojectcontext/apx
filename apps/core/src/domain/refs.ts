// Model refs: "<engine>/<model>" ("claude/opus", "gemini/gemini-3.6-flash", "acp:opencode/big-pickle"), or an
// engine alone when it has a default model of its own. One parser for every place that reads them.
import type { HarnessId } from "@apx/protocol";

export function parseRef(ref: string): { engine: string; model?: string | undefined } {
  const i = ref.indexOf("/");
  return i > 0 ? { engine: ref.slice(0, i), model: ref.slice(i + 1) || undefined } : { engine: ref };
}

export const engineOf = (ref: string): string => parseRef(ref).engine;

const HARNESS_ENGINES = new Set<string>(["claude", "codex"]);

/** The harness that runs a model ref: Claude Code, Codex or an ACP agent for theirs, our own loop for providers. */
export const harnessOf = (ref: string): HarnessId => {
  const e = engineOf(ref);
  if (e.startsWith("acp:")) return "acp";
  return HARNESS_ENGINES.has(e) ? (e as HarnessId) : "native";
};

/** Which engines exist now: the agent CLIs found on this machine and the model APIs set up. */
export type EngineIds = { harness: { has(id: string): boolean }; providers: { has(id: string): boolean } };
