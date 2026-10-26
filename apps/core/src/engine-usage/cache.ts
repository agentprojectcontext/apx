import type { EngineUsageReport } from "@apx/protocol";

/** Cache failures too: repeated panel opens must not launch another account probe. */
export function cachedEngineUsage(
  read: () => Promise<EngineUsageReport>,
  now: () => number = Date.now,
): () => Promise<EngineUsageReport> {
  let cached: { report: EngineUsageReport; at: number } | undefined;
  let pending: Promise<EngineUsageReport> | undefined;
  return () => {
    const time = now();
    const resetPassed = cached?.report.engines.some((engine) =>
      engine.windows.some((window) => {
        const reset = window.resets_at ? Date.parse(window.resets_at) : NaN;
        return reset > (cached?.at ?? time) && reset <= time;
      }),
    );
    if (cached && !resetPassed && time >= cached.at && time - cached.at < 60_000) {
      return Promise.resolve(cached.report);
    }
    pending ??= read()
      .then((report) => {
        cached = { report, at: now() };
        return report;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
