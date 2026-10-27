// How far agents go on their own: none by default; the owner turns limits on, changes or removes them in Config › Agents.
import { expect, open, rpc, test } from "./kit.ts";

type Limits = { runs: number; tokens: number };

test("the owner changes the limits on agents working on their own in Config › Agents", async ({ page }) => {
  await rpc("agents.set_limits", { runs: 0, tokens: 0 });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("agentes");
  await page
    .getByRole("option", { name: /^Agentes/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByRole("heading", { name: "Cuando los agentes trabajan solos" })).toBeVisible();

  // Off by default: turning it on starts from room for a large feature.
  const limitsOn = dialog.getByRole("switch", { name: "Poner límites" });
  await expect(limitsOn).not.toBeChecked();
  await expect(dialog.getByRole("spinbutton", { name: "Turnos sin vos" })).toHaveCount(0);
  await limitsOn.click();
  await expect.poll(() => rpc<Limits>("agents.limits")).toMatchObject({ runs: 100, tokens: 5_000_000 });
  await rpc("agents.set_limits", { runs: 30, tokens: 1_500_000 });
  await page.reload();
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("agentes");
  await page
    .getByRole("option", { name: /^Agentes/ })
    .first()
    .click();

  const tokens = dialog.getByRole("spinbutton", { name: "Tokens sin vos" });
  await expect(tokens).toHaveValue("1500");
  await tokens.fill("2000");
  await tokens.press("Enter");
  await expect.poll(async () => (await rpc<Limits>("agents.limits")).tokens).toBe(2_000_000);

  // Emptied, one limit goes; the switch removes both and hides the numbers.
  const runs = dialog.getByRole("spinbutton", { name: "Turnos sin vos" });
  await runs.fill("");
  await runs.press("Enter");
  await expect.poll(async () => (await rpc<Limits>("agents.limits")).runs).toBe(0);
  await limitsOn.click();
  await expect(runs).toHaveCount(0);
  await expect.poll(() => rpc<Limits>("agents.limits")).toMatchObject({ runs: 0, tokens: 0 });
  await limitsOn.click();
  await expect(dialog.getByRole("spinbutton", { name: "Tokens sin vos" })).toHaveValue("5000");

  await rpc("agents.set_limits", { runs: 0, tokens: 0 });
});
