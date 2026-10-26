import { expect, open, rpc, test } from "./kit.ts";

test("search stays centered with unequal sides and activity precedes notifications", async ({ page }) => {
  await rpc("setup.finish");
  await open(page);
  await page.locator(".topbar__crumbs").evaluate((crumbs) => {
    crumbs.textContent = "A very long project name and a conversation that must not move search";
  });
  for (const width of [1836, 1600, 1599, 1536, 1500, 1499, 1440, 1280, 980, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.locator(".topbar").evaluate((bar) => {
      const bounds = bar.getBoundingClientRect();
      const search = bar.querySelector(".topbar__search")?.getBoundingClientRect();
      const right = bar.querySelector(".topbar__right")?.getBoundingClientRect();
      if (!search || !right) throw new Error("Missing topbar controls");
      return {
        center: Math.abs((search.left + search.right) / 2 - (bounds.left + bounds.right) / 2),
        overlap: search.right - right.left,
        overflow: bar.scrollWidth - bar.clientWidth,
        searchOverflow: [...bar.querySelectorAll(".topbar__search svg, .topbar__search .apx-kbd")].some((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width > 0 && (rect.left < search.left || rect.right > search.right);
        }),
      };
    });
    expect(geometry.center, `center ${width}`).toBeLessThanOrEqual(1);
    expect(geometry.overlap, `overlap ${width}`).toBeLessThanOrEqual(0);
    expect(geometry.overflow, `overflow ${width}`).toBeLessThanOrEqual(1);
    expect(geometry.searchOverflow, `search content ${width}`).toBe(false);
  }
  await expect(page.locator(".topbar__activity > :first-child")).toHaveClass(/running/);
});

test("pending usage has one anonymous preview until the empty report arrives", async ({ page }) => {
  await rpc("setup.finish");
  const usage = Promise.withResolvers<void>();
  await page.route("**/rpc/engines.usage", async (route) => {
    await usage.promise;
    await route.fulfill({ json: { ok: true, result: { checked_at: new Date().toISOString(), engines: [] } } });
  });
  await open(page);
  await page.getByTestId("engine-usage-button").click();
  const loading = page.getByTestId("usage-loading");
  await expect(loading).toBeVisible();
  await expect(loading.getByRole("heading")).toHaveCount(0);
  await expect(loading.locator("section")).toHaveCount(1);
  await expect(loading).not.toContainText("100%");
  usage.resolve();
  await expect(page.getByTestId("engine-usage-summary")).toContainText("No hay engines seleccionados");
  await expect(page.getByTestId("engine-usage-summary").locator(".apx-meter")).toHaveCount(0);
});

test("selected engines missing from the installed catalog still use one anonymous loading preview", async ({
  page,
}) => {
  await rpc("setup.finish");
  for (const engine of ["codex", "opencode", "claude", "antigravity"])
    await rpc("engines.set_usage", { engine, enabled: engine === "codex" || engine === "opencode" });
  await page.route("**/rpc/engines.status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: { engines: [{ id: "codex", label: "Codex", installed: true, logged_in: false, default: false }] },
      },
    }),
  );
  const usage = Promise.withResolvers<void>();
  await page.route("**/rpc/engines.usage", async (route) => {
    await usage.promise;
    await route.fulfill({
      json: {
        ok: true,
        result: {
          checked_at: new Date().toISOString(),
          engines: ["codex", "opencode"].map((id) => ({
            id,
            label: id === "codex" ? "Codex" : "OpenCode",
            cli_installed: false,
            available: false,
            status: "unavailable",
            source: "none",
            reason: "cli_not_found",
            windows: [],
          })),
        },
      },
    });
  });
  await open(page);
  await page.getByTestId("engine-usage-button").click();
  const loading = page.getByTestId("usage-loading");
  await expect(loading.locator("section")).toHaveCount(1);
  await expect(loading.getByRole("heading")).toHaveCount(0);
  usage.resolve();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary.getByRole("heading", { name: "OpenCode", exact: true })).toBeVisible();
  await expect(summary.locator(".apx-meter")).toHaveCount(0);
});

test("shared blob eyes retain the avatar canvas inside an icon button and chat headers animate", async ({ page }) => {
  await rpc("setup.finish");
  await open(page);
  const eyes = page.locator(".topbar__agent .apx-blob__eyes");
  await expect(eyes).toBeVisible();
  const geometry = await eyes.evaluate((svg) => {
    const button = svg.closest("button");
    if (!button) throw new Error("Missing avatar button");
    const original = button.className;
    const results = ["apx-iconbtn--sm", "apx-iconbtn--md", "apx-iconbtn--lg", "apx-btn"].map((variant) => {
      button.className = `topbar__agent ${variant}`;
      const eye = svg.getBoundingClientRect();
      const body = svg.parentElement?.querySelector("img")?.getBoundingClientRect();
      if (!body) throw new Error("Missing canonical blob body");
      return { width: Math.abs(eye.width - body.width), height: Math.abs(eye.height - body.height) };
    });
    button.className = original;
    return results;
  });
  for (const measurement of geometry) {
    expect(measurement.width).toBeLessThan(1);
    expect(measurement.height).toBeLessThan(1);
  }
  await page.locator(".topbar__agent").click();
  await page.getByRole("menuitem").first().click();
  const blob = page.locator(".chat__agentbtn .apx-blob");
  await expect(blob).toHaveClass(/apx-blob--anim/);
  await expect(blob.locator(".apx-blob__bob")).toHaveCSS("animation-name", "apx-blob-float");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(blob.locator(".apx-blob__bob")).toHaveCSS("animation-name", "none");
});
