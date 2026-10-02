import type { Run } from "@apx/protocol";

/** How full the chat is, from the newest run that said so (runs newest first); undefined while none has. */
export function contextOf(runs: readonly Run[]): { used: number; window?: number } | undefined {
  const last = runs.find((r) => r.usage?.context);
  return last?.usage?.context ? { used: last.usage.context, window: last.usage.window } : undefined;
}

/** Token counts read the same in every language: "38k", "1.0M". */
export function tokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}
