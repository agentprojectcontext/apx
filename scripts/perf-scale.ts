/**
 * How much slower than CI the machine running `pnpm perf` is, from `APX_PERF_TIME_SCALE` (the remote runner's box sets
 * it). Unset is CI's own speed; less than 1 would tighten the gate, so it is refused.
 */
export function timeScale(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 1;
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale < 1)
    throw new Error(`APX_PERF_TIME_SCALE must be a number of at least 1, got ${value}`);
  return scale;
}

/** The time budgets (`*_ms`) stretched by `scale`; sizes, memory and CPU share are the same on every machine. */
export function budgetAt(budget: Record<string, number>, scale: number): Record<string, number> {
  return Object.fromEntries(Object.entries(budget).map(([k, v]) => [k, k.endsWith("_ms") ? v * scale : v]));
}
