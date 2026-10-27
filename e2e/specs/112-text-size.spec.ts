import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("text size previews, persists and remains usable on a narrow screen", async ({ page }) => {
  await rpc("setup.finish");
  await open(page);
  const composer = page.getByRole("textbox", { name: /^Escribile a/ });
  const normalComposer = await composer.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await openSettings(page);
  await page.getByRole("button", { name: "Apariencia", exact: true }).click();
  const sizes = page.getByRole("radiogroup", { name: "Tamaño del texto", exact: true });
  await expect(sizes.getByRole("radio", { name: "100%", exact: true })).toBeChecked();
  const normal = await sizes
    .getByRole("radio", { name: "100%", exact: true })
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  for (const size of [85, 115, 130, 100]) {
    await sizes.getByRole("radio", { name: `${size}%`, exact: true }).click();
    await expect(sizes.getByRole("radio", { name: `${size}%`, exact: true })).toBeChecked();
    const font = await sizes
      .getByRole("radio", { name: `${size}%`, exact: true })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(font).toBeCloseTo((normal * size) / 100, 1);
  }
  await sizes.getByRole("radio", { name: "100%", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(sizes.getByRole("radio", { name: "115%", exact: true })).toBeChecked();
  await sizes.getByRole("radio", { name: "130%", exact: true }).click();
  expect(
    await page.locator(".apx-composer textarea").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeCloseTo(normalComposer * 1.3, 1);
  expect(
    await page
      .locator(".apx-fill")
      .first()
      .evaluate((el) => getComputedStyle(el).zoom),
  ).toBe("1");
  await page.reload();
  await openSettings(page);
  await page.getByRole("button", { name: "Apariencia", exact: true }).click();
  await expect(sizes.getByRole("radio", { name: "130%", exact: true })).toBeChecked();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(sizes.getByRole("radio", { name: "85%", exact: true })).toBeVisible();
    await expect(sizes.getByRole("radio", { name: "130%", exact: true })).toBeVisible();
    expect(await sizes.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press("Escape");
  await expect(sizes).not.toBeVisible();
  await expect(composer).toBeVisible();
  expect(await composer.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(
    normalComposer * 1.3,
    1,
  );
  expect(await page.locator(".topbar").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("invalid persisted text sizes use normal text", async ({ page }) => {
  await rpc("setup.finish");
  await page.addInitScript(() => {
    localStorage.setItem("apx.prefs", JSON.stringify({ textSize: -400, language: "en" }));
  });
  await open(page);
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Text size", exact: true }).getByRole("radio", { name: "100%", exact: true }),
  ).toBeChecked();
});
