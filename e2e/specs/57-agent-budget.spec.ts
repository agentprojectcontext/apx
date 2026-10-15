// An agent's own budget without the owner, set in its detail: the core keeps it, it shows again after a reload, and
// emptying both fields takes it away.
import { expect, open, rpc, test } from "./kit.ts";

test("the owner gives an agent its own budget from its detail and takes it back", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page, "#project=~default&tab=team");
  await page.getByRole("button", { name: /^Ver: / }).first().click();
  const detail = page.locator(".teamdetail");
  const turns = detail.getByRole("spinbutton", { name: "Turnos sin vos" });
  const tokens = detail.getByRole("spinbutton", { name: "Miles de tokens sin vos" });
  await expect(turns).toHaveAttribute("placeholder", "Sin límite");

  await turns.fill("5");
  await turns.press("Enter");
  await tokens.fill("150");
  await tokens.press("Enter");
  await expect
    .poll(async () => Object.values((await rpc("agents.limits", {})).agents as Record<string, unknown>))
    .toEqual([{ runs: 5, tokens: 150_000 }]);

  await page.reload();
  await page.getByRole("button", { name: /^Ver: / }).first().click();
  await expect(turns).toHaveValue("5");
  await expect(tokens).toHaveValue("150");

  await turns.fill("");
  await turns.press("Enter");
  await tokens.fill("");
  await tokens.press("Enter");
  await expect.poll(async () => (await rpc("agents.limits", {})).agents).toEqual({});
});
