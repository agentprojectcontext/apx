// Routines: one that sends a Telegram message by hand, run now; its row keeps a full strip of activation bars, and its
// detail and the run's conversation open in a drawer at the right.
import { expect, open, rpc, test, until } from "./kit.ts";

test("a routine that sends a message is created and runs now", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await page.getByRole("tab", { name: "Rutinas" }).click();
  await page.getByRole("button", { name: "Nueva rutina" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox", { name: "Nombre" }).fill("ping-me");
  await editor.getByRole("combobox", { name: "Acción" }).click();
  await page.getByRole("option", { name: /Telegram/ }).click();
  await editor.getByRole("textbox", { name: "Qué hacer" }).fill("Ping from the routine");
  await editor.getByRole("button", { name: "Guardar" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText("ping-me")).toBeVisible();

  await page.getByRole("button", { name: "Correr ahora" }).first().click();
  const routines = await rpc<{ routines: Array<{ id: string; name: string }> }>("routines.list", {});
  const r = routines.routines.find((x) => x.name === "ping-me");
  expect(r).toBeTruthy();
  await until(async () => {
    const runs = await rpc<{ runs: Array<{ state: string }> }>("routines.runs", { routine: r?.id });
    return runs.runs.some((x) => x.state === "completed");
  });

  // A daily routine shows its last 14 expected activations: the one that ran is colored, the rest gray.
  const row = page.locator(".rtrow", { hasText: "ping-me" });
  const bars = row.getByRole("img", { name: "Últimas activaciones" });
  await expect(bars.locator(".rtbar")).toHaveCount(14);
  await expect(bars.locator(".rtbar:not(.is-none)")).toHaveCount(1);
  await expect(bars.locator(".rtbar.is-none").first()).toHaveAttribute("title", /No corrió/);

  // The routine opens beside the list; a run opens its conversation in the same drawer, and back returns.
  await row.getByRole("button", { name: /ping-me/ }).click();
  const drawer = page.getByRole("complementary", { name: "ping-me" });
  await expect(drawer).toBeVisible();
  const activations = drawer.getByRole("region", { name: "Activaciones" });
  await expect(activations.getByRole("img", { name: "Últimas activaciones" }).locator(".rtbar")).toHaveCount(14);
  await activations.getByRole("button").first().click();
  // The run opens with its instructions folded (the same words, hidden), then what it sent.
  await expect(drawer.getByRole("paragraph").filter({ hasText: "Ping from the routine" })).toBeVisible();
  await drawer.getByRole("button", { name: "Volver a la rutina" }).click();
  await expect(activations).toBeVisible();
  // Escape steps back out of a run first, then closes the drawer.
  await activations.getByRole("button").first().click();
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("region", { name: "Activaciones" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
