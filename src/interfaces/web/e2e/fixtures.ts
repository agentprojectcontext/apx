import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_FILE = path.join(HERE, ".runtime.json");

export interface Runtime {
  token: string;
  daemon: string;
  projectId: number;
  projectPath: string;
  tmpDir: string;
  startedAt: string;
}

export function runtime(): Runtime {
  return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
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
