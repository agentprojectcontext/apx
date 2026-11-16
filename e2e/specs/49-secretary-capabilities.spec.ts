import type { Routine } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("secretary switches preserve existing instructions and are absent from New routine", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("profiles.set", { id: "secretary", values: {} });
  const { routines } = await rpc<{ routines: Routine[] }>("routines.list", {});
  const news = routines.find((r) => r.action === "relay");
  expect(news).toBeTruthy();
  await rpc("secretary.set", { action: "relay", id: news?.id, enabled: false, prompt: "Only customer deadlines" });
  await open(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Ver a / })
    .first()
    .click();
  await page
    .locator(".teamdetail.is-panel")
    .getByRole("button", { name: /Perfil: / })
    .click();
  const config = page.getByRole("dialog", { name: "Editar super-agente" });
  await config.getByRole("button", { name: "Cómo te avisa" }).click();
  await expect(config.getByRole("combobox", { name: "Por dónde te habla" })).toBeVisible();
  // Only rows with something to set: no heading without controls, no row that only links elsewhere.
  await expect(config.getByText("Capacidades de secretaría", { exact: true })).toHaveCount(0);
  await expect(config.getByText("Mails nuevos", { exact: true })).toHaveCount(0);
  const toggle = config.getByRole("switch", { name: "Novedades del equipo", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await config.getByRole("button", { name: "Personalizar instrucciones", exact: true }).last().click();
  await expect(config.getByRole("textbox", { name: "Instrucciones", exact: true })).toHaveValue(
    "Only customer deadlines",
  );
  await config.getByRole("textbox", { name: "Instrucciones", exact: true }).fill("Only urgent customer deadlines");
  await config.locator(".config__inner").getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(config.getByRole("textbox", { name: "Instrucciones", exact: true })).toBeHidden();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await config.getByRole("button", { name: /^Perfil/ }).click();
  await config.getByRole("radio", { name: /Secretaria/ }).click();
  await config.getByRole("button", { name: "Cómo te avisa" }).click();
  await expect(toggle).not.toBeChecked();
  const after = (await rpc<{ routines: Routine[] }>("routines.list", {})).routines.filter((r) => r.action === "relay");
  expect(after).toHaveLength(1);
  expect(after[0]?.id).toBe(news?.id);
  expect(after[0]?.prompt).toBe("Only urgent customer deadlines");
  expect(after[0]?.enabled).toBe(false);
  await page.keyboard.press("Escape");
  await open(page, "#project=~default&tab=routines");
  await expect(page.locator(".rtrow", { hasText: news?.name })).toHaveCount(0);
  await page.getByRole("button", { name: "Nueva rutina", exact: true }).click();
  await page.getByRole("dialog").getByRole("combobox", { name: "Acción", exact: true }).click();
  await expect(page.getByRole("option", { name: /Novedades del equipo|Mails/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Shell/ })).toBeVisible();
});
