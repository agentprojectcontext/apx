import type { Run } from "@apx/protocol";

/**
 * How full the chat is, from the newest finished run (runs newest first). Engines that do not report it (Claude
 * Code, Codex) leave no figure rather than an older, stale one.
 */
export function contextOf(runs: readonly Run[]): { used: number; window?: number } | undefined {
  const last = runs.find((r) => r.usage);
  return last?.usage?.context ? { used: last.usage.context, window: last.usage.window } : undefined;
}

/** Tokens this chat has spent (input + output of every run that reported them); undefined when none did. */
export function spentOf(runs: readonly Run[]): number | undefined {
  const reported = runs.filter((r) => r.usage);
  return reported.length ? reported.reduce((n, r) => n + (r.usage?.input ?? 0) + (r.usage?.output ?? 0), 0) : undefined;
}

/** Token counts read the same in every language: "38k", "1.0M". */
export function tokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}
