/** A wall-clock budget may stretch on slow runners, never change a test's outcome. */
const timeScale = (() => {
  const value = Number(process.env.TEST_TIME_SCALE);
  return Number.isFinite(value) && value >= 1 ? value : 1;
})();

export const scaled = (ms: number) => Math.round(ms * timeScale);
type Truthy<T> = Exclude<T, false | 0 | "" | null | undefined>;

/** Waits for real I/O using a wall-clock budget, never a fixed number of attempts. */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  what = "the condition",
  options: { ms?: number; every?: number } = {},
): Promise<Truthy<T>> {
  const budget = scaled(options.ms ?? 5000);
  const end = performance.now() + budget;
  while (true) {
    const value = await check();
    if (value) return value as Truthy<T>;
    if (performance.now() >= end) throw new Error(`timed out after ${budget} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, options.every ?? 20));
  }
}
