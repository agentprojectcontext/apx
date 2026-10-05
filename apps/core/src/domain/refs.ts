// Model refs: "<engine>/<model>" ("claude/opus", "gemini/gemini-3.6-flash", "acp:opencode/big-pickle"), or an
// engine alone when it has a default model of its own; "#<effort>" at the end asks for that reasoning effort
// ("codex/gpt-6-sol#high"). One parser for every place that reads them.
import type { HarnessId } from "@apx/protocol";

export function parseRef(ref: string): {
  engine: string;
  model?: string | undefined;
  effort?: string | undefined;
} {
  const hash = ref.lastIndexOf("#");
  const effort = hash > 0 ? ref.slice(hash + 1) || undefined : undefined;
  const base = hash > 0 ? ref.slice(0, hash) : ref;
  const i = base.indexOf("/");
  const parts = i > 0 ? { engine: base.slice(0, i), model: base.slice(i + 1) || undefined } : { engine: base };
  return effort ? { ...parts, effort } : parts;
}

export const engineOf = (ref: string): string => parseRef(ref).engine;

const HARNESS_ENGINES = new Set<string>(["claude", "codex"]);

/** The harness that runs a model ref: Claude Code, Codex or an ACP agent for theirs, our own loop for providers. */
export const harnessOf = (ref: string): HarnessId => {
  const e = engineOf(ref);
  if (e.startsWith("acp:")) return "acp";
  return HARNESS_ENGINES.has(e) ? (e as HarnessId) : "native";
};

/**
 * Whether a ref names an agent CLI (Claude Code, Codex, an ACP agent). Those run only in their own sessions; agents,
 * the router and the install default run on model APIs. See DECISIONS.md#d-043
 */
export const isCliRef = (ref: string): boolean => harnessOf(ref) !== "native";

/** Which engines exist now: the agent CLIs found on this machine and the model APIs set up. */
export type EngineIds = { harness: { has(id: string): boolean }; providers: { has(id: string): boolean } };
