import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { compilerGeneratedChunks } from "../scripts/coverage-maps.ts";

type BrowserScript = Awaited<ReturnType<Page["coverage"]["stopJSCoverage"]>>[number];

/** Only the sandbox's own built scripts belong to this repository's function inventory. */
export function localBrowserScripts(
  root: string,
  origin: string,
  entries: Pick<BrowserScript, "url" | "functions">[],
  generated: ReadonlySet<string> = new Set(),
) {
  return entries.flatMap((entry) => {
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      return [];
    }
    const asset = /^\/assets\/([\w.-]+\.js)$/.exec(url.pathname)?.[1];
    if (url.origin !== origin || !asset || generated.has(`assets/${asset}`)) return [];
    return [{ url: pathToFileURL(path.join(root, "apps/web/dist/assets", asset)).href, functions: entry.functions }];
  });
}

/** Off during normal E2E runs; the coverage runner supplies a private output folder. */
export async function startPageCoverage(page: Page): Promise<() => Promise<void>> {
  const dir = process.env.APX_TEST_COVERAGE_DIR;
  if (!dir) return async () => {};
  const origins = new Set<string>();
  const navigation = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    const url = new URL(frame.url());
    if (url.protocol === "http:" && url.hostname === "127.0.0.1") origins.add(url.origin);
  };
  page.on("framenavigated", navigation);
  navigation(page.mainFrame());
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  return async () => {
    page.off("framenavigated", navigation);
    if (page.isClosed()) return;
    const entries = await page.coverage.stopJSCoverage();
    const root = path.resolve(import.meta.dirname, "..");
    const generated = compilerGeneratedChunks(path.join(root, "apps/web/dist"));
    const result = [...origins].flatMap((origin) => localBrowserScripts(root, origin, entries, generated));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `browser-${randomUUID()}.json`), JSON.stringify({ result }));
  };
}
