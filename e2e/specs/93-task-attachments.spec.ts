import { expect, open, rpc, test } from "./kit.ts";

const image = {
  name: "brief.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  ),
};
type Detail = { task: { id: string }; attachments: Array<{ media_id: string; name: string }> };

test("task attachments persist across creation and reload, preview, download, and detach independently of comments", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  await view.getByRole("button", { name: "Nueva tarea" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind durable assets");
  await dialog.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles(image);
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(dialog).toBeHidden();
  await view.getByText("Northwind durable assets", { exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Northwind durable assets" });
  const assets = panel.getByRole("region", { name: "Adjuntos", exact: true });
  await expect(assets.getByRole("img", { name: "brief.png", exact: true })).toBeVisible();
  await assets.getByRole("img", { name: "brief.png", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "brief.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await assets
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Northwind attachment snapshot") });
  await expect(assets.getByRole("button", { name: /^notes\.txt / })).toBeVisible();
  const listed = await rpc<{ tasks: Array<{ id: string; title: string }> }>("tasks.list", {});
  const task = listed.tasks.find((t) => t.title === "Northwind durable assets");
  expect(task).toBeDefined();
  const detail = () => rpc<Detail>("tasks.get", { task: task?.id });
  await expect
    .poll(async () => (await detail()).attachments.map((a) => a.name).sort())
    .toEqual(["brief.png", "notes.txt"]);
  await page.reload();
  await expect(assets.getByRole("button", { name: /^notes\.txt / })).toBeVisible();
  const download = page.waitForEvent("download");
  await assets.getByRole("button", { name: /^notes\.txt / }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("notes.txt");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("Northwind attachment snapshot");
  await assets.getByRole("button", { name: "Quitar adjunto brief.png", exact: true }).click();
  await expect(assets.getByRole("img", { name: "brief.png", exact: true })).toBeHidden();
  await expect.poll(async () => (await detail()).attachments.map((a) => a.name).sort()).toEqual(["notes.txt"]);
});

test("task uploads show size errors and enforce the attachment count before creating", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind upload validation");
  const input = dialog.getByLabel("Adjuntar archivos", { exact: true });
  await input.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(dialog.getByRole("alert")).toContainText("large.png");
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await input.setInputFiles(
    Array.from({ length: 21 }, (_, i) => ({
      name: `note-${i}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("A note"),
    })),
  );
  await expect(dialog.getByRole("alert")).toHaveText("Podés adjuntar hasta 20 archivos acá.");
  await input.setInputFiles(image);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Quitar adjunto brief.png", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeHidden();
});

test("existing tasks accept more than 20 attachments and stop at 50", async ({ page }) => {
  await rpc("setup.finish", {});
  const uploaded = await Promise.all(
    Array.from({ length: 49 }, (_, i) =>
      rpc<{ media: { id: string } }>("media.upload", {
        name: `asset-${i}.txt`,
        mime: "text/plain",
        data: Buffer.from(`Asset ${i}`).toString("base64"),
      }),
    ),
  );
  const ids = uploaded.map((a) => a.media.id);
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Northwind attachment capacity",
    attachments: ids.slice(0, 20),
  });
  await rpc("tasks.attach", { task: task.id, media_ids: ids.slice(20, 40) });
  await rpc("tasks.attach", { task: task.id, media_ids: ids.slice(40) });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByText("Northwind attachment capacity", { exact: true }).click();
  const assets = page
    .getByRole("complementary", { name: "Northwind attachment capacity" })
    .getByRole("region", { name: "Adjuntos" });
  await expect(assets.getByRole("button", { name: "Adjuntar archivos", exact: true })).toBeEnabled();
  await assets.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles([
    { name: "extra-a.txt", mimeType: "text/plain", buffer: Buffer.from("A") },
    { name: "extra-b.txt", mimeType: "text/plain", buffer: Buffer.from("B") },
  ]);
  await expect(assets.getByRole("alert")).toHaveText("Podés adjuntar hasta 50 archivos acá.");
  await assets
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "last.txt", mimeType: "text/plain", buffer: Buffer.from("Last") });
  await expect(assets.getByRole("button", { name: /^last\.txt / })).toBeVisible();
  await expect(assets.getByRole("button", { name: "Adjuntar archivos", exact: true })).toBeDisabled();
  await expect.poll(async () => (await rpc<Detail>("tasks.get", { task: task.id })).attachments.length).toBe(50);
});
