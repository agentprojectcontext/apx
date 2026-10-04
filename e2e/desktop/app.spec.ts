// The desktop app itself (Electron), against the same sandboxed core as the panel's specs: its window shows the
// panel, it lends its embedded browser to the core as a node, a tab an agent opens shows in the panel, and the
// menu-bar quick chat talks to the super-agent. Its data folder is a temp one (APX_DESKTOP_DATA; on a Mac the system
// ignores HOME for it): the owner's APX, its sessions and its single-instance lock are never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { rpc, until } from "../specs/kit.ts";

const root = path.resolve(import.meta.dirname, "../..");
const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;

let app: ElectronApplication;
let home: string;

test.beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-desktop-"));
  app = await _electron.launch({
    args: [
      path.join(root, "apps/desktop"),
      // Containers run as root, where Chromium's sandbox cannot start.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_CONNECTION: "local",
      APX_URL: core,
      // No dev server: the window falls back to the panel the core serves.
      APX_WEB_URL: "http://127.0.0.1:9",
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(home, { recursive: true, force: true });
});

/** The window's panel or the quick chat, by the page each one loads. */
async function page(which: "main" | "quick"): Promise<Page> {
  return until(async () =>
    app.windows().find((p) => {
      const quick = p.url().includes("quick=1");
      return p.url().startsWith(core) && (which === "quick" ? quick : !quick);
    }),
  );
}

test("the window shows the panel the core serves", async () => {
  const main = await page("main");
  await expect(main.getByRole("textbox", { name: /^Escribile a|^Message/ }).or(main.getByRole("dialog"))).toBeVisible();
});

test("the app lends its browser to the core, and a tab opened through the core is listed", async () => {
  await until(async () => {
    const h = await rpc<{ subsystems: Record<string, { status: string }> }>("system.health");
    return h.subsystems.browser?.status === "ok";
  }, 20_000);
  // The app's own origins are blocked in tabs: the sandbox's control API is an ordinary page.
  const page = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? 7461}/info`;
  const { tab } = await rpc<{ tab: string }>("browser.open", { url: page, by: "e2e" });
  const tabs = await until(async () => {
    const r = await rpc<{ tabs: Array<{ tab: string; url: string }> }>("browser.tabs");
    return r.tabs.find((t) => t.tab === tab) ? r.tabs : undefined;
  });
  expect(tabs.find((t) => t.tab === tab)?.url).toBe(page);
  await rpc("browser.close", { tab });
});

test("the quick chat opens from Window ▸ Quick chat and talks to the super-agent", async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quick")?.click());
  const quick = await page("quick");
  const box = quick.getByRole("textbox").first();
  await expect(box).toBeVisible();
  await box.fill("Desde la barra de menú");
  await box.press("Enter");
  await expect(quick.getByText("Got it: Desde la barra de menú")).toBeVisible();
});

test("closing the window hides it: APX keeps running, and Dock/activate brings it back", async () => {
  // The main window is the only one that is not a BrowserWindow (the quick chat is).
  const mainShown = () =>
    app.evaluate(({ BaseWindow, BrowserWindow }) =>
      BaseWindow.getAllWindows()
        .filter((w) => !(w instanceof BrowserWindow))
        .map((w) => w.isVisible()),
    );
  await app.evaluate(({ BaseWindow, BrowserWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => !(w instanceof BrowserWindow))
      ?.close(),
  );
  expect(await mainShown()).toEqual([false]);
  await app.evaluate(({ app }) => app.emit("activate"));
  expect(await mainShown()).toEqual([true]);
});
