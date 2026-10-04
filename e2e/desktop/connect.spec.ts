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
  const chooser = await windowAt(first, (u) => u.endsWith("/connect.html"));
  await expect(chooser.locator("#pick-server")).toBeVisible();
  await expect(chooser.locator("#pick-client")).toBeVisible();
  await chooser.locator("#pick-server").click();
  await expect(chooser.locator('input[name="access"][value="none"]')).toBeChecked();
  await chooser.locator("#server-go").click();
  await windowAt(first, (u) => u.startsWith(core));
  expect(JSON.parse(fs.readFileSync(path.join(home, "desktop", "connection.json"), "utf8"))).toEqual({ mode: "local" });
  await first.close();

  const again = await launch();
  await windowAt(again, (u) => u.startsWith(core));
  expect(again.windows().some((p) => p.url().endsWith("/connect.html"))).toBe(false);
  await again.close();
});

test("a client address that does not answer is refused on the spot", async () => {
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const app = await launch();
  const chooser = await windowAt(app, (u) => u.endsWith("/connect.html"));
  await chooser.locator("#pick-client").click();
  await chooser.locator("#url").fill("http://127.0.0.1:9");
  await chooser.locator("#client-go").click();
  await expect(chooser.locator("#client-error")).toBeVisible();
  expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
  await app.close();
});
