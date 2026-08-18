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
      } catch {
        /* ignore */
      }
    }, rt.token);
    await use(page);
  },
});

export { expect };
