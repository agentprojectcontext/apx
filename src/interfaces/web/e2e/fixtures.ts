import { test as base, expect } from "@playwright/test";
import { RUNTIME_FILE, readRuntime, type Runtime } from "./throwaway";

export type { Runtime };

export function runtime(): Runtime {
  const rt = readRuntime();
  if (!rt) {
    throw new Error(`no ${RUNTIME_FILE} — global-setup did not run (or failed)`);
  }
  return rt;
}

// `page` is pre-seeded with the bearer token in localStorage so the panel
// authenticates deterministically before first paint. `errors` collects any
// uncaught page exceptions during the test so specs can assert the screen
// rendered without blowing up.
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await use(errs);
  },
  page: async ({ page }, use) => {
    const rt = runtime();
    await page.addInitScript((tok) => {
      try {
        localStorage.setItem("apx.token", tok as string);
        // The corner cards, already closed. They are a real card over the
        // bottom-right corner, and a fresh browser — which every run is — shows
        // one. It covered `task-comment-send` and took that click for itself,
        // and the spec that failed never mentions these cards, so the failure
        // pointed nowhere near the cause. Dismissed the way a returning user
        // would have them: through the same keys the panel writes.
        localStorage.setItem("apx.discord.dismissed", "1");
        localStorage.setItem("apx.star.dismissed", "1");
        localStorage.setItem("apx.notify.nudge.dismissed", "1");
        localStorage.setItem("apx.install.dismissed", "1");
        localStorage.setItem("apx.mobilehint.dismissed", "1");
      } catch {
        /* ignore */
      }
    }, rt.token);
    await use(page);
  },
});

export { expect };
