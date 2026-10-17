// The frame: the list is resized (never folded away), icon buttons say what they do, the language switches with no key
// left untranslated, and Settings opens every section.
import type { Page } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

// Done with the setup wizard: this spec must not depend on an earlier one having finished it.
test.beforeAll(async () => {
  await rpc("setup.finish");
});

test("the chat list resizes from its edge and never folds away; an icon button says what it does", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Plegar la lista" })).toHaveCount(0);
  await page.getByRole("button", { name: /herramientas/ }).hover();
  await expect(page.getByText(/cada paso del agente/)).toBeVisible();

  const handle = page.getByRole("separator", { name: "Cambiar el ancho de la lista" });
  const before = await handle.getAttribute("aria-valuenow");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await handle.getAttribute("aria-valuenow")).not.toBe(before);
});

test("a chain entry picks one of the model APIs' models; the CLIs are not offered", async ({ page }) => {
  await open(page);
  await openSettings(page);
  await page.getByRole("dialog").getByRole("button", { name: "Router" }).click();
  await page.getByRole("button", { name: "Agregar un modelo" }).click();
  await expect(page.getByRole("option", { name: /GPT e2e/ })).toHaveCount(0);
  await page.getByRole("option", { name: /fake-2/ }).click();
  await page.getByRole("button", { name: "Guardar router" }).click();
  await expect
    .poll(async () => (await rpc<{ router: { chain: string[] } }>("models.config")).router.chain)
    .toContain("custom/fake-2");
  await page.keyboard.press("Escape");
});

test("an agent picks its own model from the list, and one button leaves it on the router alone", async ({ page }) => {
  await open(page);
  await openSettings(page);
  await page.getByRole("dialog").getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
  await page
    .getByRole("button", { name: /^Modelo de / })
    .first()
    .click();
  await expect(page.getByText("En uso")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /voz, imagen y embeddings/ })).toHaveCount(0);
  await page.getByRole("option", { name: /fake-2/ }).click();
  const choiceOf = async () =>
    (await rpc<{ agents: Array<{ kind: string; model_choice?: { model: string } }> }>("agents.list")).agents.find(
      (a) => a.kind === "secretary",
    )?.model_choice?.model;
  await expect.poll(choiceOf).toBe("custom/fake-2");

  await page
    .getByRole("button", { name: /^Modelo de / })
    .first()
    .click();
  await page.getByRole("button", { name: "Dejar solo el router" }).click();
  await expect.poll(choiceOf).toBeUndefined();
  await page.keyboard.press("Escape");
});

/** The language is in the top bar, or in its "more" menu when the bar has no room. */
async function pickLanguage(page: Page, button: RegExp, more: string, language: string) {
  const direct = page.getByRole("button", { name: button });
  await ((await direct.isVisible()) ? direct : page.getByRole("button", { name: more })).click();
  await page.getByRole("menuitem", { name: language }).click();
}

test("English and Spanish show text, never a raw key", async ({ page }) => {
  await open(page);
  await pickLanguage(page, /^Idioma/, "Más opciones", "English");
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\.[a-zA-Z.]+\b/);
  await pickLanguage(page, /^Language/, "More options", "Español");
  await expect(page.getByRole("button", { name: "Tareas" })).toBeVisible();
});

test("Settings opens each section", async ({ page }) => {
  await open(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const sections = dialog.getByRole("navigation").getByRole("button");
  const n = await sections.count();
  expect(n).toBeGreaterThan(4);
  for (let i = 0; i < n; i++) await sections.nth(i).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
