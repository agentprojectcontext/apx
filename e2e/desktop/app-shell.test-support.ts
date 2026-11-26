import fs from "node:fs";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { ALL_SLIDES } from "../../apps/web/src/shell/welcomeFilm.ts";
import { assertSandboxDesktopData } from "../sandbox.ts";
import { ownSandbox, rpc, world } from "../specs/kit.ts";

/** The native tab's bounds and stacking order, distinct from the full-window panel view. */
export async function nativeTabBounds(app: ElectronApplication) {
  return app.evaluate(({ BaseWindow }) => {
    const win = BaseWindow.getAllWindows().find((w) => w.contentView.children.length > 0);
    const kids = win?.contentView.children ?? [];
    if (kids.length < 2) return null;
    const full = win?.getContentBounds();
    const i = kids.findIndex((k) => {
      const b = k.getBounds();
      return !(b.x === 0 && b.y === 0 && b.width === full?.width && b.height === full?.height);
    });
    const at = i < 0 ? 0 : i;
    const view = kids[at];
    if (!view) return null;
    return { on: at === kids.length - 1 ? ("top" as const) : ("behind" as const), ...view.getBounds() };
  });
}

/** Refuse the owner's data folder and wait for this test's own core before opening Electron. */
export async function launchSandboxApp(entry: string, env: NodeJS.ProcessEnv): Promise<ElectronApplication> {
  assertSandboxDesktopData(env.APX_DESKTOP_DATA);
  await ownSandbox();
  return _electron.launch({
    args: [entry, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: env as Record<string, string>,
  });
}

export async function launchDesktop(home: string): Promise<ElectronApplication> {
  await rpc("setup.finish");
  // Keep the native tray reachable by the test, without adding a bridge to the product.
  const entry = path.join(home, "tray-test.cjs");
  fs.writeFileSync(
    entry,
    `
    const { Tray } = require("electron");
    const on = Tray.prototype.on;
    Tray.prototype.on = function (...args) {
      globalThis.apxTestTray = this;
      return on.apply(this, args);
    };
    const setImage = Tray.prototype.setImage;
    Tray.prototype.setImage = function (image) {
      globalThis.apxTestTrayImage = image.toDataURL();
      globalThis.apxTestTrayTemplate = image.isTemplateImage();
      return setImage.call(this, image);
    };
    const setToolTip = Tray.prototype.setToolTip;
    Tray.prototype.setToolTip = function (text) {
      globalThis.apxTestTrayTooltip = text;
      return setToolTip.call(this, text);
    };
    void import(${JSON.stringify(path.resolve(import.meta.dirname, "../../apps/desktop/dist/main.js"))});
  `,
  );
  return launchSandboxApp(entry, {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    APX_DESKTOP_DATA: path.join(home, "desktop"),
    APX_QUIT_CONFIRM: "off",
    APX_TELEMETRY: "off",
    DO_NOT_TRACK: "1",
    APX_CONNECTION: "local",
    APX_URL: "",
    APX_HOME: (await world.info()).home,
    APX_PORT: process.env.E2E_PORT ?? "7460",
    APX_WEB_URL: "http://127.0.0.1:9",
  });
}

export async function assertDesktopHeader(app: ElectronApplication, main: Page): Promise<void> {
  await expect(main.locator(".topbar.is-desktop")).toBeVisible();
  const geometry = await main.locator(".topbar").evaluate((bar) => {
    const rect = bar.getBoundingClientRect();
    const group = bar.querySelector(".topbar__center")?.getBoundingClientRect();
    const nav = bar.querySelector(".topbar__nav")?.getBoundingClientRect();
    const search = bar.querySelector(".topbar__search")?.getBoundingClientRect();
    const right = bar.querySelector(".topbar__right")?.getBoundingClientRect();
    if (!group || !nav || !search || !right) throw new Error("Missing topbar controls");
    return {
      y: rect.y,
      height: rect.height,
      // History arrows and search form the centered group, as in the panel.
      center: (group.left + group.right) / 2,
      width: innerWidth,
      navOverlap: nav.right - search.left,
      rightOverlap: search.right - right.left,
      overflow: bar.scrollWidth - bar.clientWidth,
      drag: getComputedStyle(bar).getPropertyValue("-webkit-app-region"),
    };
  });
  expect(geometry.y).toBe(0);
  expect(geometry.height).toBe(46);
  expect(geometry.center).toBeCloseTo(geometry.width / 2, 0);
  expect(geometry.navOverlap).toBeLessThanOrEqual(0);
  expect(geometry.rightOverlap).toBeLessThanOrEqual(0);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.drag).toBe("drag");
  const bounds = await app.evaluate(({ BaseWindow, BrowserWindow }) => {
    const main = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow));
    return { outer: main?.getBounds(), content: main?.getContentBounds() };
  });
  expect(Math.abs((bounds.outer?.height ?? 0) - (bounds.content?.height ?? 0))).toBeLessThanOrEqual(2);
  await main.screenshot({ path: test.info().outputPath("unified-header.png") });
}

export async function assertFullscreenBar(app: ElectronApplication, main: Page): Promise<void> {
  // The welcome and corner cards would cover the screen: seen already, as in the panel's own specs.
  await main.evaluate((seen) => {
    localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcomeSeen: seen }));
    location.hash = "#view=flows";
    location.reload();
  }, ALL_SLIDES);
  await main.getByRole("button", { name: /^(Nuevo flow|New flow)$/ }).click();
  const bar = main.locator(".fe-top.window-bar.is-desktop");
  await expect(bar).toBeVisible();
  const read = () =>
    bar.evaluate((b) => {
      const style = getComputedStyle(b);
      const region = (el: Element | null) => (el ? getComputedStyle(el).getPropertyValue("-webkit-app-region") : "");
      return {
        left: Number.parseFloat(style.paddingLeft),
        right: Number.parseFloat(style.paddingRight),
        drag: region(b),
        picker: region(b.querySelector('[role="combobox"]')),
        close: region(b.querySelector("button")),
      };
    });
  const windowed = await read();
  expect(windowed).toMatchObject({ drag: "drag", picker: "no-drag", close: "no-drag" });
  if (process.platform === "darwin") {
    expect(windowed.left).toBe(76);
    const full = (on: boolean) =>
      app.evaluate(({ BaseWindow, BrowserWindow }, on) => {
        BaseWindow.getAllWindows()
          .find((w) => !(w instanceof BrowserWindow))
          ?.setFullScreen(on);
      }, on);
    await full(true);
    await expect.poll(async () => (await read()).left, { timeout: 10_000 }).toBe(12);
    await full(false);
    await expect.poll(async () => (await read()).left, { timeout: 10_000 }).toBe(76);
  } else {
    expect(windowed.right).toBe(140);
  }
  await main.getByRole("button", { name: /^(Salir del editor|Exit the editor)$/ }).click();
  await expect(bar).toHaveCount(0);
}
