// Tasks: the one v1 left open came in with the import; a new one is created, opened and closed; renamed and copied.
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

test("a task is renamed in its panel, and its id or a reference to it is copied to share it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await rpc("setup.finish", {});
  const task = await rpc<{ id: string }>("tasks.create", { title: "Northwind brief", description: "desc" });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  // The list's row: once the panel is open its title box holds the same words.
  const row = (name: string) => view.getByRole("listitem").getByText(name, { exact: true });

  // Right-click on the row: the id, then a line naming it for an agent's chat.
  await row("Northwind brief").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copiar ID" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(task.id);
  await row("Northwind brief").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copiar referencia" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`Tarea “Northwind brief” (${task.id})`);

  // The title edits in place; Escape drops the edit and leaves the panel open, Enter saves it.
  await row("Northwind brief").click();
  const title = page.getByRole("textbox", { name: "Renombrar la tarea" });
  await title.fill("Scrapped name");
  await title.press("Escape");
  await expect(title).toHaveValue("Northwind brief");
  await expect(title).toBeVisible();
  await title.fill("Northwind brief v2");
  await title.press("Enter");
  const get = async () => (await rpc<{ task: { title: string } }>("tasks.get", { task: task.id })).task.title;
  await expect.poll(get).toBe("Northwind brief v2");
  await expect(row("Northwind brief v2")).toBeVisible();

  // The panel's own menu copies it too.
  await page
    .getByRole("complementary", { name: "Northwind brief v2" })
    .getByRole("button", { name: "Más", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Copiar ID" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(task.id);
});
