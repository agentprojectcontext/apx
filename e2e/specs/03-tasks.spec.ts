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
  const drawer = page.getByRole("complementary", { name: "Call Northwind about the quote" });
  await expect(drawer).toBeVisible();
  // Escape closes the drawer; the list stays where it was.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await view.getByText("Call Northwind about the quote").click();
  await page.getByRole("button", { name: "Hecha" }).first().click();
  await expect
    .poll(async () => {
      const done = await rpc<{ tasks: Array<{ title: string }> }>("tasks.list", { state: "done" });
      return done.tasks.some((t) => t.title === "Call Northwind about the quote");
    })
    .toBe(true);
});

test("a commitment: a new date agreed keeps it open, then it is marked kept", async ({ page }) => {
  const ana = await rpc<{ id: string }>("contacts.set", { name: "Northwind buyer", role: "contact" });
  const c = await rpc<{ id: string }>("tasks.create", {
    title: "Send Northwind the quote",
    description: "desc",
    person: ana.id,
  });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  await view.getByText("Send Northwind the quote").click();

  await page.getByRole("button", { name: "Nueva fecha" }).click();
  await page.getByRole("button", { name: "Mañana" }).click();
  const task = async () =>
    (await rpc<{ task: { renegotiated: number; outcome?: string } }>("tasks.get", { task: c.id })).task;
  await expect.poll(async () => (await task()).renegotiated).toBe(1);
  await expect(page.getByText("Fecha movida 1×")).toBeVisible();

  await page.getByRole("button", { name: "Cumplido" }).click();
  await expect.poll(async () => (await task()).outcome).toBe("kept");
  await expect(page.getByText("Cumplido", { exact: true })).toBeVisible();
});

test("a task's right-click menu deletes it, after asking", async ({ page }) => {
  const doomed = await rpc<{ id: string }>("tasks.create", { title: "Old Northwind draft", description: "desc" });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  await view.getByText("Old Northwind draft").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Borrar", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Borrar tarea" });
  await expect(confirm).toContainText("Old Northwind draft");
  await confirm.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(view.getByText("Old Northwind draft")).toBeHidden();
  await expect(rpc("tasks.get", { task: doomed.id })).rejects.toThrow(/not found/);
});
