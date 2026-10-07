// The first run asks how APX is used on this computer (server or client); the answer is kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;
let home: string;

const launch = () =>
  _electron.launch({
    args: [path.join(root, "apps/desktop"), ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_URL: core,
      APX_WEB_URL: "http://127.0.0.1:9",
    },
  });

/** The intro holds the hero alone for a moment; a key skips straight to the question. */
async function question(page: Page): Promise<Page> {
  await page.keyboard.press("Space");
  await expect(page.locator(".connect__stage.is-ready")).toBeVisible();
  return page;
}

async function windowAt(app: ElectronApplication, test: (url: string) => boolean): Promise<Page> {
  await expect.poll(() => app.windows().some((p) => test(p.url())), { timeout: 20_000 }).toBe(true);
  return app.windows().find((p) => test(p.url())) as Page;
}

test.beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-connect-"));
});
test.afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("the first run asks server or client; server opens this computer's APX and is not asked again", async () => {
  const first = await launch();
  const chooser = await question(await windowAt(first, (u) => u.startsWith("apx-app://")));
  await expect(chooser.locator("#pick-server")).toBeVisible();
  await expect(chooser.locator("#pick-client")).toBeVisible();
  await chooser.locator("#pick-server").click();
  await expect(chooser.locator('[data-access="none"]')).toHaveAttribute("aria-pressed", "true");
  await chooser.locator("#server-go").click();
  await windowAt(first, (u) => u.startsWith(core));
  expect(JSON.parse(fs.readFileSync(path.join(home, "desktop", "connection.json"), "utf8"))).toEqual({ mode: "local" });
  await first.close();

  const again = await launch();
  await windowAt(again, (u) => u.startsWith(core));
  expect(again.windows().some((p) => p.url().startsWith("apx-app://"))).toBe(false);
  await again.close();
});

test("a client address that does not answer is refused on the spot", async () => {
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const app = await launch();
  const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
  await chooser.locator("#pick-client").click();
  await chooser.locator("#url").fill("http://127.0.0.1:9");
  await chooser.locator("#client-go").click();
  await expect(chooser.locator("#client-error")).toBeVisible();
  expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
  await app.close();
});

test("change connection goes back to the question in the same window, and the app stays up", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  await windowAt(app, (u) => u.startsWith(core));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("change-connection")?.click());
  await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
  expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
  // The checkout's core is still the one the e2e started: nothing took it down.
  expect((await fetch(`${core}/health`)).ok).toBe(true);
  await app.close();
});

test("About opens APX's own window with this build's versions and the repo", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  await windowAt(app, (u) => u.startsWith(core));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("about")?.click());
  const about = await windowAt(app, (u) => u.includes("?about"));
  await expect(about.locator(".about__version")).toContainText("APX");
  await expect(about.locator(".about__status")).toBeVisible();
  await expect(about.locator(".about__list")).toContainText("Electron");
  await expect(about.locator(".about__repo")).toHaveAttribute("href", /github\.com/);
  await app.close();
});
