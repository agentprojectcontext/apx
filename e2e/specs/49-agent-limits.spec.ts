// How far agents go on their own: the owner turns a limit off or changes it in Config › Agents, and the core keeps it.
import { expect, open, rpc, test } from "./kit.ts";

type Limits = { runs: number; tokens: number };

test("the owner changes the limits on agents working on their own in Config › Agents", async ({ page }) => {
  await rpc("agents.set_limits", { runs: 16, tokens: 600_000 });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("agentes");
  await page.getByRole("option", { name: /^Agentes/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByRole("heading", { name: "Cuando los agentes trabajan solos" })).toBeVisible();

  const tokens = dialog.getByRole("spinbutton", { name: "Tokens sin vos" });
  await expect(tokens).toHaveValue("600");
  await tokens.fill("2000");
  await tokens.press("Enter");
  await expect.poll(async () => (await rpc<Limits>("agents.limits")).tokens).toBe(2_000_000);

  await dialog.getByRole("switch", { name: "Turnos sin vos" }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Turnos sin vos" })).toHaveCount(0);
  await expect.poll(async () => (await rpc<Limits>("agents.limits")).runs).toBe(0);

  await rpc("agents.set_limits", { runs: 16, tokens: 600_000 });
});
