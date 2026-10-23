import { formatNumber } from "../common/format.ts";

// Kept apart from common/format.ts: only the task panel, loaded on demand, uses it.
/** A count at a glance: "950", "12K", "2.4M" (the same letters in every language). */
export function formatCompact(n: number): string {
  if (n < 1000) return formatNumber(n);
  if (n < 1_000_000) return `${formatNumber(n / 1000, { maximumFractionDigits: n < 10_000 ? 1 : 0 })}K`;
  return `${formatNumber(n / 1_000_000, { maximumFractionDigits: 1 })}M`;
}
