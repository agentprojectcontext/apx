import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`OpenAI image preset saves the current model and preserves existing choices (${language}, ${width})`, async ({
      page,
    }, info) => {
      await rpc("setup.finish");
      const id = `image-preset-${language}-${width}`;
      const en = language === "en";
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
      await open(page);
      await page.getByRole("button", { name: en ? /^Account/ : /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: en ? /^Settings(?! wizard)/ : /^Configuración(?! inicial)/ }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: en ? "Images" : "Imágenes", exact: true })
        .click();
      await page
        .locator(".config__content")
        .getByRole("button", { name: en ? "Add" : "Agregar", exact: true })
        .click();
      const dialog = page.getByRole("dialog").last();
      await dialog.getByRole("button", { name: "OpenAI", exact: true }).click();
      const model = dialog.getByRole("textbox", { name: en ? "Model" : "Modelo", exact: true });
      await expect(model).toHaveValue("gpt-image-2.5-sunburst");
      await page.screenshot({ path: info.outputPath("preset.png"), fullPage: true });
      await dialog.getByRole("textbox", { name: en ? "Name" : "Nombre", exact: true }).fill(id);
      await dialog.getByRole("textbox", { name: en ? "Base URL" : "URL base", exact: true }).fill("http://127.0.0.1:9");
      await dialog.getByRole("button", { name: en ? "Save" : "Guardar", exact: true }).click();
      await expect(dialog).toHaveCount(1);
      const read = async () =>
        (
          await rpc<{ services: Array<{ id: string; model?: string }> }>("services.list", { kind: "image" })
        ).services.find((s) => s.id === id);
      expect((await read())?.model).toBe("gpt-image-2.5-sunburst");
      await rpc("services.set", {
        id,
        service: {
          kind: "image",
          dialect: "openai-images",
          label: id,
          enabled: true,
          needs_key: false,
          base_url: "http://127.0.0.1:9",
          model: "gpt-image-1",
        },
      });
      await page
        .locator(".config__content")
        .getByRole("button", { name: en ? "Refresh" : "Actualizar", exact: true })
        .click();
      await page
        .locator(".res__row")
        .filter({ hasText: id })
        .getByRole("button", { name: en ? "Edit" : "Editar", exact: true })
        .click();
      await expect(model).toHaveValue("gpt-image-1");
      await expect(dialog.getByRole("status")).toBeVisible();
      await page.screenshot({ path: info.outputPath("saved-model-error.png"), fullPage: true });
      await dialog.getByRole("button", { name: en ? "Save" : "Guardar", exact: true }).click();
      expect((await read())?.model).toBe("gpt-image-1");
      await rpc("services.set", { id, service: null });
    });
  }
}
