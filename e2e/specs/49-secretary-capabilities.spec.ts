import type { Routine } from "../../packages/protocol/src/index.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("secretary switches preserve existing instructions and are absent from New routine", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("profiles.set", { id: "secretary", values: {} });
  const { routines } = await rpc<{ routines: Routine[] }>("routines.list", {});
  const mail = routines.find((r) => r.action === "mail");
  expect(mail).toBeTruthy();
  await rpc("secretary.set", { action: "mail", id: mail?.id, enabled: false, prompt: "Only customer deadlines" });
  await open(page);
  await openSettings(page);
  const config = page.getByRole("dialog", { name: "Configuración" });
  await config.getByRole("button", { name: "Super-agente", exact: true }).click();
  await expect(config.getByText("Capacidades de secretaría", { exact: true })).toBeVisible();
  const toggle = config.getByRole("switch", { name: "Mails importantes", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await config.getByRole("button", { name: "Personalizar instrucciones", exact: true }).last().click();
  await expect(config.getByRole("textbox", { name: "Instrucciones", exact: true })).toHaveValue(
    "Only customer deadlines",
  );
  await config.getByRole("textbox", { name: "Instrucciones", exact: true }).fill("Only urgent customer deadlines");
  await config.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(config.getByRole("textbox", { name: "Instrucciones", exact: true })).toBeHidden();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await config.getByRole("radio", { name: /Secretaria/ }).click();
  await expect(toggle).not.toBeChecked();
  const after = (await rpc<{ routines: Routine[] }>("routines.list", {})).routines.filter((r) => r.action === "mail");
  expect(after).toHaveLength(1);
  expect(after[0]?.id).toBe(mail?.id);
  expect(after[0]?.prompt).toBe("Only urgent customer deadlines");
  expect(after[0]?.enabled).toBe(false);
  await page.keyboard.press("Escape");
  await open(page, "#project=~default&tab=routines");
  await expect(page.locator(".rtrow", { hasText: mail?.name })).toHaveCount(0);
  await page.getByRole("button", { name: "Nueva rutina", exact: true }).click();
  await page.getByRole("dialog").getByRole("combobox", { name: "Acción", exact: true }).click();
  await expect(page.getByRole("option", { name: /Novedades del equipo|Mails importantes/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Shell/ })).toBeVisible();
});
