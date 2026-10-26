import { expect, open, openSettings, rpc, test } from "./kit.ts";

function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { wait: promise, release: resolve };
}

const report = {
  checked_at: "2026-01-01T12:00:00.000Z",
  engines: [
    {
      id: "codex",
      label: "Codex",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "codex_app_server",
      windows: [{ id: "primary", used_percent: 37, window_minutes: 300 }],
    },
  ],
};

test("el consumo IA mantiene tarjetas skeleton al cargar, actualizar y reabrir", async ({ page }) => {
  await rpc("setup.finish");
  let pending = gate();
  let calls = 0;
  let response = report;
  await page.route("**/rpc/engines.usage", async (route) => {
    calls++;
    const wait = pending.wait;
    await wait;
    await route.fulfill({ json: { ok: true, result: response } });
  });
  await open(page);
  const trigger = page.getByTestId("engine-usage-button");
  await trigger.click();
  const preview = page.getByTestId("usage-loading");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
  expect((await preview.boundingBox())?.height).toBeGreaterThanOrEqual(300);
  await expect(preview.locator(".apx-skeleton").first()).toBeVisible();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary).toHaveAttribute("aria-busy", "true");
  await expect(summary.getByRole("button", { name: "Actualizar" })).toBeDisabled();
  await expect(summary.locator(".apx-meter")).toHaveCount(0);
  expect(calls).toBe(1);
  pending.release();
  await expect(summary.getByText("63% disponible")).toBeVisible();
  await expect(page.getByTestId("engine-usage-quick")).toHaveText("63%");
  response = {
    ...report,
    engines: report.engines.map((engine) => ({
      ...engine,
      windows: [{ id: "primary", used_percent: 80, window_minutes: 300 }],
    })),
  };
  pending = gate();
  await summary.getByRole("button", { name: "Actualizar" }).click();
  await expect(preview).toBeVisible();
  await expect(summary.getByText("63% disponible")).toHaveCount(0);
  pending.release();
  await expect(summary.getByText("20% disponible")).toBeVisible();
  await expect(page.getByTestId("engine-usage-quick")).toHaveText("20%");
  expect(calls).toBe(2);
  await page.keyboard.press("Escape");
  pending = gate();
  await trigger.click();
  await expect(preview).toBeVisible();
  pending.release();
  await expect(summary.getByText("20% disponible")).toBeVisible();
});

test("el consumo de sistema tiene preview también mientras llega el código lazy y la lectura detallada", async ({
  page,
}) => {
  await rpc("setup.finish");
  const code = gate();
  const pack = gate();
  const data = gate();
  let packRequested = false;
  let detailRequested = false;
  await page.route(/\/assets\/UsagePanels-[^/]+\.js$/, async (route) => {
    await code.wait;
    await route.continue();
  });
  await page.route(/\/assets\/sysusage-es-[^/]+\.js$/, async (route) => {
    packRequested = true;
    await pack.wait;
    await route.continue();
  });
  await page.route("**/rpc/system.usage", async (route) => {
    if (route.request().postDataJSON().disk) {
      detailRequested = true;
      await data.wait;
    }
    await route.continue();
  });
  await open(page);
  const trigger = page.getByTestId("usage-button");
  await trigger.click();
  const preview = page.getByTestId("usage-loading");
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())?.height).toBeGreaterThanOrEqual(300);
  code.release();
  await expect.poll(() => packRequested).toBe(true);
  await expect(preview).toBeVisible();
  pack.release();
  await expect.poll(() => detailRequested).toBe(true);
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("usage-summary")).toHaveCount(0);
  data.release();
  await expect(page.getByTestId("usage-summary").getByRole("heading", { name: "CPU" })).toBeVisible();
  await expect(preview).toHaveCount(0);
});

test("los botones de consumo muestran tooltips con teclado y hover sin perder su nombre accesible", async ({
  page,
}) => {
  await rpc("setup.finish");
  await open(page);
  const ai = page.getByTestId("engine-usage-button");
  await ai.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(ai).toBeFocused();
  await expect(page.locator(".apx-tooltip[data-open]")).toHaveText("Consumo de IA");
  await expect(ai).toHaveAccessibleName("Consumo de IA");
  const system = page.getByTestId("usage-button");
  await system.hover();
  await expect(page.locator(".apx-tooltip[data-open]")).toContainText("Consumo");
  await expect(system).toHaveAccessibleName(/Consumo/);
});

test("cuatro engines se ven de un vistazo y colapsan en una barra ocupada y con controles nativos", async ({
  page,
}) => {
  await rpc("setup.finish");
  const engines = ["claude", "codex", "opencode", "gemini"].map((id) => ({
    ...report.engines[0],
    id,
    label: id,
    windows: [
      { id: "primary", used_percent: 37, window_minutes: 300 },
      { id: "secondary", used_percent: 80, window_minutes: 10080 },
    ],
  }));
  await page.route("**/rpc/engines.usage", (route) =>
    route.fulfill({ json: { ok: true, result: { ...report, engines } } }),
  );
  await open(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const quick = page.getByTestId("engine-usage-quick");
  await expect(quick).toHaveCount(4);
  await expect(quick.first()).toBeVisible();
  await expect(quick.first()).toHaveText("20%");
  await page.getByTestId("engine-usage-button").hover();
  await expect(page.locator(".apx-tooltip[data-open]")).toContainText("claude: 20% disponible · 10080 min");
  // Exercise the real bar's optional occupants without depending on an updater or a live run.
  await page.locator(".topbar__right").evaluate((right) => {
    for (const name of ["updatepill", "updatepill", "running"]) {
      const button = document.createElement("button");
      button.className = name;
      button.innerHTML =
        '<svg width="14" height="14"></svg>' +
        (name === "running" ? "" : '<span class="updatepill__label">Update available</span>');
      right.prepend(button);
    }
  });
  for (const platform of ["", "is-desktop is-win", "is-desktop is-linux", "is-desktop is-mac"]) {
    await page.locator(".topbar").evaluate((bar, suffix) => {
      bar.setAttribute("class", `topbar ${suffix}`);
    }, platform);
    for (const width of platform ? [1600, 1440, 1280, 980] : [1600, 1440, 1280, 900, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.locator(".topbar").evaluate((bar) => ({
        overflow: bar.scrollWidth - bar.clientWidth,
        overlap:
          (bar.querySelector(".topbar__search")?.getBoundingClientRect().right ?? 0) -
          (bar.querySelector(".topbar__right")?.getBoundingClientRect().left ?? 0),
      }));
      expect(metrics.overflow, `${platform} overflow ${width}`).toBeLessThanOrEqual(1);
      expect(metrics.overlap, `${platform} overlap ${width}`).toBeLessThanOrEqual(0);
      await expect(page.getByTestId("engine-usage-button")).toBeVisible();
      if (width < 1400) await expect(quick.first()).toBeHidden();
    }
  }
});

test("barra compacta sin overflow conserva accesos, idioma en submenú y tema accesible sin movimiento", async ({
  page,
}) => {
  await rpc("setup.finish");
  await open(page);
  for (const width of [1440, 1280, 900, 768, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.locator(".topbar").evaluate((bar) => {
      const search = bar.querySelector(".topbar__search")?.getBoundingClientRect();
      const right = bar.querySelector(".topbar__right")?.getBoundingClientRect();
      if (!search || !right) throw new Error("Missing topbar groups");
      return { overflow: bar.scrollWidth - bar.clientWidth, overlap: search.right - right.left };
    });
    expect(metrics.overflow, `overflow at ${width}`).toBeLessThanOrEqual(1);
    expect(metrics.overlap, `overlap at ${width}`).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("engine-usage-button")).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: /teléfono|idioma|modo oscuro|modo claro/i }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Más opciones" }).click();
  await expect(page.getByRole("menuitem", { name: "Consumo", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Idioma", exact: true }).hover();
  await expect(page.getByRole("menuitem", { name: "English" })).toBeVisible();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible();
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "Language", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Español" }).click();
  await openSettings(page);
  await page.getByRole("button", { name: "Apariencia", exact: true }).click();
  const theme = page.getByRole("switch", { name: "Oscuro", exact: true });
  const before = await theme.getAttribute("aria-checked");
  await theme.focus();
  await page.keyboard.press("Space");
  await expect(theme).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await theme.locator(".theme-switch__thumb").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
    "0s",
  );
  await page.getByRole("button", { name: "Dispositivos", exact: true }).click();
  await page.getByRole("button", { name: "Abrir en el teléfono", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Abrir en el teléfono", exact: true })).toBeVisible();
});
