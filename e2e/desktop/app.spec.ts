// The desktop app itself (Electron), against the same sandboxed core as the panel's specs: its window shows the
// panel, it lends its embedded browser to the core as a node, a tab an agent opens shows in the panel, and the
// menu-bar quick chat talks to the super-agent. Its data folder is a temp one (APX_DESKTOP_DATA; on a Mac the system
// ignores HOME for it): the owner's APX, its sessions and its single-instance lock are never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { rpc, until, world } from "../specs/kit.ts";

const root = path.resolve(import.meta.dirname, "../..");
const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;

let app: ElectronApplication;
let home: string;

test.beforeAll(async () => {
  await rpc("setup.finish");
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-desktop-"));
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
    void import(${JSON.stringify(path.join(root, "apps/desktop/dist/main.js"))});
  `,
  );
  app = await _electron.launch({
    args: [
      entry,
      // Containers run as root, where Chromium's sandbox cannot start.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_QUIT_CONFIRM: "off",
      APX_CONNECTION: "local",
      APX_URL: "",
      APX_HOME: (await world.info()).home,
      APX_PORT: process.env.E2E_PORT ?? "7460",
      // No dev server: the window falls back to the panel the core serves.
      APX_WEB_URL: "http://127.0.0.1:9",
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(home, { recursive: true, force: true });
});

/** The menu-bar icon, which the app makes with the quick chat once it is up (the entry script keeps it for tests). */
async function trayReady(): Promise<void> {
  await expect
    .poll(() => app.evaluate(() => Boolean((globalThis as unknown as { apxTestTray?: unknown }).apxTestTray)))
    .toBe(true);
}

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

test("the desktop header shares the native title bar and keeps its search centered", async () => {
  const main = await page("main");
  await expect(main.locator(".topbar.is-desktop")).toBeVisible();
  const geometry = await main.locator(".topbar").evaluate((bar) => {
    const rect = bar.getBoundingClientRect();
    const search = bar.querySelector(".topbar__search")?.getBoundingClientRect();
    return {
      y: rect.y,
      height: rect.height,
      center: search ? search.x + search.width / 2 : -1,
      width: innerWidth,
      drag: getComputedStyle(bar).getPropertyValue("-webkit-app-region"),
    };
  });
  expect(geometry.y).toBe(0);
  expect(geometry.height).toBe(46);
  expect(geometry.center).toBeCloseTo(geometry.width / 2, 0);
  expect(geometry.drag).toBe("drag");
  const bounds = await app.evaluate(({ BaseWindow, BrowserWindow }) => {
    const main = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow));
    return { outer: main?.getBounds(), content: main?.getContentBounds() };
  });
  expect(Math.abs((bounds.outer?.height ?? 0) - (bounds.content?.height ?? 0))).toBeLessThanOrEqual(2);
  await main.screenshot({ path: test.info().outputPath("unified-header.png") });
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

test("tray clicks keep their display even if the pointer moves during the double-click delay", async () => {
  await trayReady();
  await page("quick");
  const displays = await app.evaluate(({ screen }) =>
    screen.getAllDisplays().map((d) => ({ id: d.id, area: d.workArea })),
  );
  test.info().annotations.push({ type: "displays", description: String(displays.length) });
  fs.writeFileSync(test.info().outputPath("displays.json"), JSON.stringify(displays));
  for (const display of displays) {
    await app.evaluate(async ({ BrowserWindow, screen }, area) => {
      const quick = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("quick=1"));
      quick?.hide();
      const tray = (globalThis as unknown as { apxTestTray: { emit: (event: string, ...args: unknown[]) => void } })
        .apxTestTray;
      const point = { x: area.x + area.width / 2, y: area.y - 10 };
      const original = screen.getCursorScreenPoint;
      try {
        screen.getCursorScreenPoint = () => point;
        // macOS may report a local point; Linux may report the origin.
        tray.emit(
          "click",
          {},
          { x: point.x - 10, y: point.y - 10, width: 20, height: 20 },
          process.platform === "darwin" ? { x: 10, y: 10 } : process.platform === "linux" ? { x: 0, y: 0 } : point,
        );
        screen.getCursorScreenPoint = () => ({ x: area.x + area.width * 3, y: area.y });
        await new Promise((resolve) => setTimeout(resolve, 350));
      } finally {
        screen.getCursorScreenPoint = original;
      }
    }, display.area);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow, screen }) => {
          const quick = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("quick=1"));
          if (!quick?.isVisible()) return undefined;
          return screen.getDisplayMatching(quick.getBounds()).id;
        }),
      )
      .toBe(display.id);
  }
});

test("one tray click closes a visible quick chat even when the native click blurs it first", async () => {
  await trayReady();
  await page("quick");
  const visible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes("quick=1") && w.isVisible()),
    );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes("quick=1"))
      ?.hide();
    const tray = (globalThis as unknown as { apxTestTray: { emit: (event: string) => void } }).apxTestTray;
    tray.emit("click");
  });
  await expect.poll(visible).toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const quick = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("quick=1"));
    quick?.emit("blur");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tray = (globalThis as unknown as { apxTestTray: { emit: (event: string) => void } }).apxTestTray;
    tray.emit("click");
  });
  await expect.poll(visible).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(await visible()).toBe(false);
  await app.evaluate(() => {
    (globalThis as unknown as { apxTestTray: { emit: (event: string) => void } }).apxTestTray.emit("click");
  });
  await expect.poll(visible).toBe(true);
});

test("a held tray click closes the popup with stale bounds; clicking outside still dismisses it", async () => {
  await trayReady();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quick")?.click());
  await page("quick");
  const result = await app.evaluate(async ({ app: nativeApp, BaseWindow, BrowserWindow, screen }) => {
    const quick = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("quick=1"));
    const main = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow));
    if (!quick || !main) throw new Error("main or quick window is missing");
    const focus = async (window: import("electron").BaseWindow) => {
      if (process.platform === "darwin") nativeApp.focus({ steal: true });
      await new Promise<void>((resolve) => {
        const focused = () => resolve();
        window.once("focus", focused);
        window.show();
        window.focus();
        if (window.isFocused()) {
          window.removeListener("focus", focused);
          resolve();
        }
      });
    };
    const tray = (globalThis as unknown as { apxTestTray: import("electron").Tray }).apxTestTray;
    const originalPoint = screen.getCursorScreenPoint;
    const originalBounds = tray.getBounds;
    const area = screen.getPrimaryDisplay().workArea;
    const point = { x: area.x + area.width / 2, y: area.y - 10 };
    try {
      screen.getCursorScreenPoint = () => point;
      tray.getBounds = () => ({ x: point.x + 1000, y: point.y, width: 22, height: 22 });
      await focus(main);
      await focus(quick);
      if (process.platform === "darwin") tray.emit("mouse-down", {});
      await focus(main);
      quick.emit("blur");
      await new Promise((resolve) => setTimeout(resolve, process.platform === "darwin" ? 450 : 30));
      tray.emit("click", {}, { x: point.x - 10, y: point.y, width: 22, height: 22 }, point);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const closedByTray = !quick.isVisible();
      screen.getCursorScreenPoint = () => ({ x: area.x + 50, y: area.y + 50 });
      await focus(quick);
      await focus(main);
      quick.emit("blur");
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { closedByTray, closedOutside: !quick.isVisible() };
    } finally {
      screen.getCursorScreenPoint = originalPoint;
      tray.getBounds = originalBounds;
    }
  });
  expect(result.closedByTray).toBe(true);
  expect(result.closedOutside).toBe(true);
});

test("notifications add and clear the integrated tray indicator, menu-bar count and Dock count", async () => {
  await trayReady();
  const main = await page("main");
  const badge = async (count: number) => {
    await main.evaluate(
      (count) =>
        (window as unknown as { apxDesktop: { setAttention: (count: number) => void } }).apxDesktop.setAttention(count),
      count,
    );
    return app.evaluate(({ app, nativeImage }) => {
      const state = globalThis as unknown as {
        apxTestTray: import("electron").Tray;
        apxTestTrayImage: string;
        apxTestTrayTemplate: boolean;
        apxTestTrayTooltip: string;
      };
      const image = nativeImage.createFromDataURL(state.apxTestTrayImage);
      const size = image.getSize();
      const pixels = image.toBitmap();
      let bodyPixels = 0;
      let orangePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          (pixels[i + 2] ?? 0) > 220 &&
          (pixels[i + 1] ?? 0) > 70 &&
          (pixels[i + 1] ?? 0) < 200 &&
          (pixels[i] ?? 0) < 80 &&
          (pixels[i + 3] ?? 0) > 127
        )
          orangePixels++;
      }
      for (let y = Math.floor(size.height / 3); y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
          if ((pixels[(y * size.width + x) * 4 + 3] ?? 0) > 127) bodyPixels++;
        }
      }
      return {
        title: process.platform === "darwin" ? state.apxTestTray.getTitle() : "",
        tooltip: state.apxTestTrayTooltip,
        image: state.apxTestTrayImage,
        template: state.apxTestTrayTemplate,
        size,
        bodyPixels,
        orangePixels,
        dock: app.dock?.getBadge(),
      };
    });
  };
  const empty = await badge(0);
  expect(empty.tooltip).toBe("APX");
  const unread = await badge(3);
  expect(unread.tooltip).toMatch(/^APX · 3 /);
  expect(unread.image).not.toBe(empty.image);
  expect(empty.bodyPixels).toBeGreaterThan(0);
  expect(unread.size).toEqual(empty.size);
  expect(unread.bodyPixels).toBeGreaterThan(empty.bodyPixels * 0.75);
  expect(empty.orangePixels).toBe(0);
  expect(unread.orangePixels).toBeGreaterThan(0);
  if (process.platform === "darwin") {
    expect(unread.title).toBe("3");
    expect(empty.template).toBe(true);
    expect(unread.template).toBe(false);
    expect(unread.dock).toBe("3");
    const many = await badge(120);
    expect(many.title).toBe("99+");
    expect(many.dock).toBe("99+");
    expect(many.image).toBe(unread.image);
    const one = await badge(1);
    expect(one.title).toBe("1");
    expect(one.dock).toBe("1");
    const theme = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    try {
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "light";
      });
      const light = await badge(1);
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "dark";
      });
      await expect.poll(async () => (await badge(1)).image).not.toBe(light.image);
      const dark = await badge(1);
      expect(dark.orangePixels).toBe(light.orangePixels);
      expect(dark.template).toBe(false);
      expect(dark.title).toBe("1");
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = "light";
      });
      await expect.poll(async () => (await badge(1)).image).toBe(light.image);
    } finally {
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
    }
  }
  expect(await badge(0)).toEqual(empty);
});

test("double-click opens the existing main window in front and cancels the quick popup", async () => {
  await trayReady();
  const id = await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    const main = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow));
    if (!main) throw new Error("main window is missing");
    await new Promise<void>((resolve) => {
      main.once("minimize", resolve);
      main.minimize();
    });
    const tray = (globalThis as unknown as { apxTestTray: { emit: (event: string, ...args: unknown[]) => void } })
      .apxTestTray;
    tray.emit("click", {});
    tray.emit("double-click", {});
    // The pending single-click deadline must pass without reopening the quick chat.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return main.id;
  });
  await expect
    .poll(() =>
      app.evaluate(({ BaseWindow, BrowserWindow }, id) => {
        const main = BaseWindow.fromId(id);
        return {
          ids: BaseWindow.getAllWindows()
            .filter((w) => !(w instanceof BrowserWindow))
            .map((w) => w.id),
          visible: main?.isVisible(),
          minimized: main?.isMinimized(),
          focused: main?.isFocused(),
          quickVisible: BrowserWindow.getAllWindows().some(
            (w) => w.webContents.getURL().includes("quick=1") && w.isVisible(),
          ),
        };
      }, id),
    )
    .toEqual({ ids: [id], visible: true, minimized: false, focused: true, quickVisible: false });
});

test("an .apxart opened from the system opens the install dialog with it, also when APX already runs", async () => {
  const made = await rpc<{ id: string }>("surfaces.show", {
    name: "opened-file",
    title: "Opened file",
    html: "<h1>Opened</h1>",
  });
  const file = path.join(home, "opened-file.apxart");
  fs.writeFileSync(file, JSON.stringify(await rpc<object>("surfaces.export", { surface: made.id, memory: false })));
  const main = await page("main");
  const dialog = main.getByRole("dialog", { name: /Instalar un artefacto|Install an artifact/ });

  // macOS hands an opened file to the running app; Windows and Linux start it again with the file's path.
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  await expect(dialog.getByText("Opened file", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Cancelar|Cancel/ }).click();
  await expect(dialog).toBeHidden();

  await app.evaluate(({ app }, file) => app.emit("second-instance", {}, ["APX", file], "/"), file);
  await expect(dialog.getByText("Opened file", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Cancelar|Cancel/ }).click();
});
