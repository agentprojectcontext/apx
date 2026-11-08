import type { Run, RunContext } from "@apx/protocol";

/**
 * How full the chat is, from the newest finished run (runs newest first). Engines that do not report it (Claude
 * Code, Codex) leave no figure rather than an older, stale one.
 */
export function contextOf(runs: readonly Run[]): { used: number; window?: number } | undefined {
  const last = runs.find((r) => r.usage);
  return last?.usage?.context ? { used: last.usage.context, window: last.usage.window } : undefined;
}

/** The run whose figure contextOf reads, to ask what it carried (runs.context). */
export function contextRunOf(runs: readonly Run[]): string | undefined {
  const last = runs.find((r) => r.usage);
  return last?.usage?.context ? last.id : undefined;
}

/** The core summarizes the oldest part of a chat once its context is this full (engine/upkeep.ts). */
export const COMPACT_AT_SHARE = 0.8;

export type ContextKind = "system" | "memory" | "tools" | "skills" | "messages";
export type ContextPart = { kind: ContextKind; tokens: number };

/**
 * What fills the context, by kind, from what the last run carried: the prompt's fixed parts are estimated from their
 * size (4 characters a token) and the rest of what the model counted is the conversation. Parts add up to `used`.
 */
export function contextParts(sizes: RunContext["sizes"], used: number): ContextPart[] {
  const chars: Record<Exclude<ContextKind, "messages">, number> = {
    system: 0,
    memory: 0,
    tools: sizes.tools,
    skills: 0,
  };
  for (const p of sizes.system) {
    if (p.name === "project_memory") chars.memory += p.chars;
    else if (p.name === "skills") chars.skills += p.chars;
    else chars.system += p.chars;
  }
  for (const p of sizes.input) if (p.name === "memory") chars.memory += p.chars;
  const fixed = (["system", "memory", "tools", "skills"] as const).map((kind) => ({
    kind,
    tokens: Math.round(chars[kind] / 4),
  }));
  const estimated = fixed.reduce((n, p) => n + p.tokens, 0);
  // An estimate past what the model counted shrinks to fit it.
  const scale = estimated > used ? used / estimated : 1;
  const parts: ContextPart[] = fixed.map((p) => ({ kind: p.kind, tokens: Math.floor(p.tokens * scale) }));
  const rest = used - parts.reduce((n, p) => n + p.tokens, 0);
  return [...parts, { kind: "messages" as const, tokens: Math.max(0, rest) }].filter((p) => p.tokens > 0);
}

/** How full the context is, 0 to 1, when the model's window is known; the core summarizes the chat near the top. */
export function shareOf(context: { used: number; window?: number } | undefined): number | undefined {
  return context?.window ? Math.min(1, context.used / context.window) : undefined;
}

/** Tokens this chat has spent, from the core's totals over all its runs; undefined when none reported any. */
export function spentOf(
  totals: { input: number; output: number; cached: number } | undefined,
): { input: number; output: number; cached: number } | undefined {
  return totals && totals.input + totals.output ? totals : undefined;
}

/** Changes when a loaded run of the chat starts or ends: the core's totals are asked again then, not per render. */
export function usageStamp(runs: readonly Run[]): string {
  const ended = runs.filter((r) => r.ended_at);
  const newest = ended.reduce((at, r) => ((r.ended_at ?? "") > at ? (r.ended_at ?? "") : at), "");
  return `${runs.length}:${ended.length}:${newest}`;
}

/** Token counts read the same in every language: "38k", "1.0M". */
export function tokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}
