import { expect, open, rpc, test } from "./kit.ts";

async function expectDiscarded(id: string) {
  await expect
    .poll(async () => {
      try {
        await rpc("media.get", { id });
        return "available";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })
    .toContain("media unavailable");
}

test("task creation waits for uploads and keeps selected assets after a failed save", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind pending attachment");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/media.upload", async (route) => {
    await held;
    await route.continue();
  });
  const uploaded = page.waitForResponse("**/rpc/media.upload");
  await dialog.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles({
    name: "pending.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Pending attachment"),
  });
  try {
    await expect(dialog.getByRole("button", { name: "Subiendo…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  const source = (await (await uploaded).json()).result.media.id as string;
  await expect(dialog.getByRole("button", { name: /^pending\.txt / })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await page.route("**/rpc/tasks.create", (route) =>
    route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Task save refused" } } }),
  );
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(page.getByText(/Tasks:|Tareas:/).last()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^pending\.txt / })).toBeVisible();
  expect((await rpc<{ bytes: number }>("media.get", { id: source })).bytes).toBeGreaterThan(0);
  await page.unroute("**/rpc/tasks.create");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectDiscarded(source);
});

test("removing or cancelling draft assets discards only pending uploads", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const uploaded = page.waitForResponse("**/rpc/media.upload");
  await dialog
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "remove.txt", mimeType: "text/plain", buffer: Buffer.from("Remove") });
  const source = (await (await uploaded).json()).result.media.id as string;
  expect((await rpc<{ bytes: number }>("media.get", { id: source })).bytes).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Quitar adjunto remove.txt", exact: true }).click();
  await expectDiscarded(source);
  await expect(dialog.getByRole("button", { name: "Quitar adjunto remove.txt", exact: true })).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Adjuntar archivos", exact: true })).toBeEnabled();
  const second = page.waitForResponse("**/rpc/media.upload");
  await dialog
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "cancel.txt", mimeType: "text/plain", buffer: Buffer.from("Cancel") });
  const cancelled = (await (await second).json()).result.media.id as string;
  await expect(dialog.getByRole("button", { name: /^cancel\.txt / })).toBeVisible();
  await page.route("**/rpc/tasks.create", (route) =>
    route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Task save refused" } } }),
  );
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind cancelled draft");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  expect((await rpc<{ bytes: number }>("media.get", { id: cancelled })).bytes).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectDiscarded(cancelled);
});

test("cancelling during upload discards the late result and stops the batch", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  await page.route("**/rpc/media.upload", async (route) => {
    uploads++;
    expect(route.request().postDataJSON()).toMatchObject({ task_asset: true });
    expect(route.request().postDataJSON()).not.toHaveProperty("thread");
    await held;
    await route.continue();
  });
  const uploaded = page.waitForResponse("**/rpc/media.upload");
  await dialog.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles([
    { name: "late.txt", mimeType: "text/plain", buffer: Buffer.from("Late") },
    { name: "never.txt", mimeType: "text/plain", buffer: Buffer.from("Never") },
  ]);
  try {
    await expect(dialog.getByRole("button", { name: "Subiendo…", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).toBeHidden();
  } finally {
    release();
  }
  const source = (await (await uploaded).json()).result.media.id as string;
  await expectDiscarded(source);
  expect(uploads).toBe(1);
});

test("a refused attach discards its temporary source without changing task assets", async ({ page }) => {
  await rpc("setup.finish", {});
  const task = await rpc<{ id: string }>("tasks.create", { title: "Northwind refused attachment" });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByText("Northwind refused attachment", { exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Northwind refused attachment" });
  await page.route("**/rpc/tasks.attach", (route) =>
    route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Attachment refused" } } }),
  );
  const uploaded = page.waitForResponse("**/rpc/media.upload");
  await panel
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "refused.txt", mimeType: "text/plain", buffer: Buffer.from("Refused") });
  const source = (await (await uploaded).json()).result.media.id as string;
  await expect(panel.getByRole("alert")).toHaveText("Attachment refused");
  await expectDiscarded(source);
  expect((await rpc<{ attachments: unknown[] }>("tasks.get", { task: task.id })).attachments).toEqual([]);
});
