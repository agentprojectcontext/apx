import fs from "node:fs";
import { expect, open, rpc, test } from "./kit.ts";

const starter = fs.readFileSync(
  new URL("../../apps/core/src/skills/apx/apx-artifacts/assets/starter.html", import.meta.url),
  "utf8",
);

test("the widget kit filters work in an edge-to-edge app and in published fragments and documents", async ({
  page,
}, testInfo) => {
  await rpc("setup.finish", {});
  const widget = await rpc<{ id: string }>("surfaces.show", {
    name: "widget-kit-test",
    title: "Widget kit",
    html: starter,
    app: false,
  });
  await open(page, `#app=${widget.id}`);
  const frame = page.locator(".surfaceframe__iframe");
  const app = page.frameLocator(".surfaceframe__iframe");
  await expect(app.getByRole("heading", { name: "Project overview" })).toBeVisible();
  const inset = await frame.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) throw new Error("missing frame host");
    return el.getBoundingClientRect().top - parent.getBoundingClientRect().top;
  });
  expect(inset).toBeGreaterThanOrEqual(16);
  await expect(app.locator(".apx-widget")).toHaveCSS("max-width", "1100px");
  await rpc("surfaces.update", { surface: widget.id, app: true });
  await expect(frame.locator("..")).toHaveCSS("padding", "0px");
  await expect(app.locator(".apx-widget")).toHaveCSS("max-width", "none");
  await expect(page.locator(".appscreen__body")).toHaveCSS("padding", "0px");
  await app.getByRole("searchbox").fill("dashboard");
  await expect(app.getByRole("status")).toHaveText("1 of 3 items");
  await expect(app.getByRole("heading", { name: "Write the quick guide" })).toBeHidden();
  await app.getByRole("button", { name: "Reset filters" }).click();
  await expect(app.getByRole("status")).toHaveText("3 of 3 items");

  // A full HTML document must receive the same kit and fallback theme as a fragment.
  for (const full of [false, true]) {
    const surface = await rpc<{ id: string }>("surfaces.show", {
      name: `widget-kit-public-${full}`,
      title: "Widget kit public",
      app: full,
      html: full ? `<!doctype html><html><head><title>Example</title></head><body>${starter}</body></html>` : starter,
    });
    const shared = await rpc<{ share_path: string }>("surfaces.share", { surface: surface.id, shared: true });
    await page.goto(shared.share_path);
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      for (const width of [1100, 360]) {
        await page.setViewportSize({ width, height: 800 });
        const layout = await page.locator(".apx-widget").evaluate((el) => {
          const grid = el.querySelector(".apx-grid");
          return {
            top: el.getBoundingClientRect().top + scrollY,
            overflow: document.documentElement.scrollWidth > innerWidth,
            grid: grid && getComputedStyle(grid).display,
            color: getComputedStyle(el).color,
          };
        });
        if (full) expect(layout.top).toBe(0);
        else expect(layout.top).toBeGreaterThanOrEqual(16);
        expect(layout.overflow).toBe(false);
        expect(layout.grid).toBe("grid");
        expect(layout.color).toBe(mode === "light" ? "rgb(22, 22, 22)" : "rgb(237, 237, 235)");
      }
      await page.getByRole("searchbox").fill("nonexistent");
      await expect(page.getByRole("status")).toHaveText("0 of 3 items");
      await expect(page.getByText("No matching work. Try another filter.")).toBeVisible();
      await expect(page.locator("#work article:visible")).toHaveCount(0);
      await page.getByRole("button", { name: "Reset filters" }).click();
      await expect(page.locator("#work article:visible")).toHaveCount(3);
    }
  }
  await rpc("surfaces.update", { surface: widget.id, app: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, `#app=${widget.id}`);
  await expect(
    page.frameLocator(".surfaceframe__iframe").getByRole("heading", { name: "Project overview" }),
  ).toBeVisible();
  await expect(page.locator(".appscreen__body .surfaceframe")).not.toHaveClass(/surfaceframe--app/);
  await page.screenshot({ path: testInfo.outputPath("widget-kit-preview.png") });
});
