// The Tasks list names what waits for the owner apart from the Review state, and narrows to one state with every task
// in it.
import { expect, open, rpc, test } from "./kit.ts";

test("Tasks shows Te esperan apart from Review, and the state filter shows one group whole", async ({ page }) => {
  const waiting = await rpc<{ id: string }>("tasks.create", { title: "Northwind contract terms", description: "d" });
  await rpc("tasks.update", { task: waiting.id, awaits_owner: true });
  const doing = await rpc<{ id: string }>("tasks.create", { title: "Acme landing copy", description: "d" });
  await rpc("tasks.update", { task: doing.id, status: "doing" });
  await open(page, "#view=tasks");
  const list = page.locator(".tasks__main");
  await expect(list.getByRole("region", { name: "Te esperan" })).toContainText("Northwind contract terms");
  await expect(list.getByRole("region", { name: "Necesita tu revisión" })).toHaveCount(0);

  await list.getByRole("combobox", { name: "Estado" }).click();
  await page.getByRole("option", { name: /^En curso/ }).click();
  await expect(list.getByRole("region", { name: "En curso" })).toContainText("Acme landing copy");
  await expect(list.getByRole("region", { name: "Te esperan" })).toHaveCount(0);

  await list.getByRole("combobox", { name: "Estado" }).click();
  await page.getByRole("option", { name: /^Todos los estados/ }).click();
  await expect(list.getByRole("region", { name: "Te esperan" })).toBeVisible();
});
