// The welcome slides: said once per device and film, each slide a clip from the docs site; where one cannot
// load, each slide's still stays in its place. Outside hosts are stood in for: the sandbox never reaches them.
import { expect, open, test } from "./kit.ts";

test.use({ welcome: true });

test("the owner steps through the slides and Skip closes them for good", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Barra lateral compacta" })).toBeVisible();
  await expect(dialog.getByText("1 de 10")).toBeVisible();
  // The film could not load: the slide's still takes its place.
  await expect(dialog.getByRole("img", { name: "Barra lateral compacta" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Atrás" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Proyectos dentro de proyectos" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "La línea de tiempo de cada rutina" })).toBeVisible();
  await expect(dialog.getByText("3 de 10")).toBeVisible();
  await dialog.getByRole("button", { name: "Atrás" }).click();
  await expect(dialog.getByRole("heading", { name: "Proyectos dentro de proyectos" })).toBeVisible();

  await dialog.getByRole("button", { name: "Saltear" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("the last slide ends with Vamos", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  for (let i = 1; i < 10; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Una revisión semanal" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Siguiente" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
});

// What a device kept after closing an earlier welcome: the v2 one, then the single-film one.
for (const kept of [true, "whats-new-2.14"]) {
  test(`someone who closed an earlier welcome (${kept}) sees the new slides once`, async ({ page }) => {
    await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
    await page.addInitScript((kept) => {
      try {
        localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcome: kept }));
      } catch {}
    }, kept);
    await open(page);
    await expect(page.getByRole("dialog", { name: "Lo nuevo de APX" })).toBeVisible();
  });
}
