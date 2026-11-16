/** What the voice last said while loading: how far it got, about how many seconds were left, and when it said so. */
export type Prep = { progress: number; left: number; at: number };

/** Where the bar is now and the seconds left: it keeps moving between reports, but only the voice says it is ready. */
export function prepareShown(prep: Prep, now: number): { shown: number; left: number } {
  const elapsed = Math.max(0, now - prep.at) / 1000;
  const shown =
    prep.left > 0 ? prep.progress + (1 - prep.progress) * Math.min(0.9, elapsed / prep.left) : prep.progress;
  return { shown, left: Math.max(0, prep.left - elapsed) };
}

/** A new report from the voice: the bar takes it, but never goes back from where it already is. */
export function nextPrep(prev: Prep | undefined, report: { progress: number; left: number }, now: number): Prep {
  const shown = prev ? prepareShown(prev, now).shown : 0;
  return { progress: Math.max(report.progress, shown), left: report.left, at: now };
}
