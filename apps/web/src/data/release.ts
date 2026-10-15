/** A release's numbers; none for a checkout's build (2.3.17-dev.4+sha) or a core run from source (0.0.0). */
const release = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) && v !== "0.0.0" ? v.split(".").map(Number) : undefined);

/** Whether release `a` comes before `b`; anything that is not a release is never compared. */
export function releaseBefore(a: string, b: string): boolean {
  const x = release(a);
  const y = release(b);
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && (x[i] ?? 0) < (y[i] ?? 0);
}
