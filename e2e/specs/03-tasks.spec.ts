// Tasks: the one v1 left open came in with the import; a new one is created, opened and closed.
import { expect, open, rpc, test } from "./kit.ts";

test("tasks: imported, created, opened and done", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  await expect(view.getByText("Ship the invoice page")).toBeVisible();

  await view.getByRole("button", { name: "Nueva tarea" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Call Northwind about the quote");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();
  await expect(view.getByText("Call Northwind about the quote")).toBeVisible();

  // Opened beside the list, marked done, and it leaves the open ones.
  await view.getByText("Call Northwind about the quote").click();
  await page.getByRole("button", { name: "Hecha" }).first().click();
  await expect
    .poll(async () => {
      const done = await rpc<{ tasks: Array<{ title: string }> }>("tasks.list", { state: "done" });
      return done.tasks.some((t) => t.title === "Call Northwind about the quote");
    })
    .toBe(true);
});
