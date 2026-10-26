import type { Result } from "@apx/protocol";
import { EngineIcon } from "@apx/ui";

type Report = Result<"engines.usage">;

/** The most constrained reported window; absent quotas never become a balance. */
export function quickWindows(report: Report | undefined) {
  return (report?.engines ?? [])
    .flatMap((engine) => {
      if (!engine.available || engine.status !== "ok") return [];
      const window = engine.windows.reduce<(typeof engine.windows)[number] | undefined>(
        (best, next) =>
          Number.isFinite(next.used_percent) && (!best || next.used_percent > best.used_percent) ? next : best,
        undefined,
      );
      return window
        ? [{ engine, window, remaining: Math.round(100 - Math.max(0, Math.min(100, window.used_percent))) }]
        : [];
    })
    .slice(0, 4);
}

export default function EngineUsageQuick({ report }: { report: Report | undefined }) {
  return (
    <span className="engine-usage-quick" aria-hidden="true">
      {quickWindows(report).map(({ engine, remaining }) => (
        <span className="engine-usage-quick__item" key={engine.id} data-testid="engine-usage-quick">
          <span className="engine-usage-quick__ring">
            <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
              <circle cx="14" cy="14" r="12" fill="none" stroke="var(--apx-border)" strokeWidth="2" />
              <circle
                cx="14"
                cy="14"
                r="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                pathLength="100"
                strokeDasharray={`${remaining} 100`}
                transform="rotate(-90 14 14)"
              />
            </svg>
            <EngineIcon engine={engine.id} size={14} />
          </span>
          <span>{remaining}%</span>
        </span>
      ))}
    </span>
  );
}
