// The frame: the list is resized (never folded away), icon buttons say what they do, the language switches with no key
// left untranslated, and Settings opens every section.
import { expect, open, rpc, test } from "./kit.ts";

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

test("a chain entry picks one of its engine's models and, when the model takes it, its reasoning effort", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Config", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Router" }).click();
  await page.getByRole("button", { name: "Agregar un modelo" }).click();
  await page.getByRole("option", { name: /GPT e2e/ }).click();
  await expect(page.getByRole("combobox", { name: "Effort" })).toBeVisible();
  await page.getByRole("combobox", { name: "Effort" }).click();
  await page.getByRole("option", { name: "high" }).click();
  await page.getByRole("button", { name: "Guardar router" }).click();
  await expect
    .poll(async () => (await rpc<{ router: { chain: string[] } }>("models.config")).router.chain)
    .toContain("codex/gpt-e2e#high");
  await page.keyboard.press("Escape");
});

test("an agent picks its own model from the list, and one button leaves it on the router alone", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Config", exact: true }).click();
  await page.getByRole("dialog").getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
  await page
    .getByRole("button", { name: /^Modelo de / })
    .first()
    .click();
  await expect(page.getByText("En uso")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /voz, imagen y embeddings/ })).toHaveCount(0);
  await page.getByRole("option", { name: /GPT e2e/ }).click();
  const choiceOf = async () =>
    (await rpc<{ agents: Array<{ kind: string; model_choice?: { model: string } }> }>("agents.list")).agents.find(
      (a) => a.kind === "secretary",
    )?.model_choice?.model;
  await expect.poll(choiceOf).toBe("codex/gpt-e2e");

  await page
    .getByRole("button", { name: /^Modelo de / })
    .first()
    .click();
  await page.getByRole("button", { name: "Dejar solo el router" }).click();
  await expect.poll(choiceOf).toBeUndefined();
  await page.keyboard.press("Escape");
});

test("English and Spanish show text, never a raw key", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Idioma/ }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\.[a-zA-Z.]+\b/);
  await page.getByRole("button", { name: /^Language/ }).click();
  await page.getByRole("menuitem", { name: "Español" }).click();
  await expect(page.getByRole("button", { name: "Tareas" })).toBeVisible();
});

test("Settings opens each section", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Config", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const sections = dialog.getByRole("navigation").getByRole("button");
  const n = await sections.count();
  expect(n).toBeGreaterThan(4);
  for (let i = 0; i < n; i++) await sections.nth(i).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
