import net, { type AddressInfo } from "node:net";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("Archivos lists what was shared, by kind and project, and leads back to the message", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({ port, llm: scriptedLlm(() => say("Ok")) });
  try {
    await env.client.call("setup.finish", {});
    const { store } = env.core;
    store.projects.upsert({ id: "p_acme", name: "Acme" });
    const launch = store.threads.create({
      kind: "loose",
      title: "Storefront launch",
      agent_ids: ["superagent"],
      project_id: "p_acme",
    });
    const errands = store.threads.create({ kind: "loose", title: "Errands", agent_ids: ["superagent"] });
    const upload = (name: string, mime: string, data: Buffer) =>
      env.client.call("media.upload", { name, mime, data: data.toString("base64") });
    const photo = (await upload("storefront.png", "image/png", PNG)).media;
    const pdf = (await upload("invoice.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF"))).media;
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 9, 0, s)).toISOString();
    const shared = store.messages.add({
      thread_id: launch.id,
      author: { kind: "user" },
      parts: [{ type: "image", media_id: photo.id, mime: photo.mime, alt: "storefront.png" }],
      at: at(0),
      quiet: true,
    });
    // Enough talk after it that the picture starts out of view.
    for (let i = 1; i <= 40; i++)
      store.messages.add({
        thread_id: launch.id,
        author: { kind: "user" },
        parts: [{ type: "text", text: `Launch note ${i}\n\nMore detail for the launch, line ${i}.` }],
        at: at(i),
        quiet: true,
      });
    store.messages.add({
      thread_id: errands.id,
      author: { kind: "user" },
      parts: [{ type: "file", media_id: pdf.id, mime: pdf.mime, name: "invoice.pdf", bytes: pdf.bytes }],
      at: at(50),
      quiet: true,
    });

    await page.goto(env.core.url);
    await page.getByRole("button", { name: "Archivos", exact: true }).click();
    const cards = page.locator(".sharedf__card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("invoice.pdf");
    await expect(cards.nth(0)).toContainText("Errands");
    await expect(cards.nth(1)).toContainText("storefront.png");
    await expect(cards.nth(1)).toContainText("Acme");
    await expect(cards.nth(1)).toContainText("Storefront launch");
    await expect(cards.nth(1)).toContainText("2026");
    await expect(cards.nth(1).locator(".sharedf__thumb img")).toBeVisible();

    await page.getByRole("radio", { name: /Documentos/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("invoice.pdf");
    await page.getByRole("radio", { name: /Todos/ }).click();
    await page.getByRole("searchbox", { name: "Buscar por nombre…" }).fill("STORE");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("storefront.png");
    await page.getByRole("searchbox", { name: "Buscar por nombre…" }).fill("");
    await page.getByRole("combobox", { name: "Orden" }).click();
    await page.getByRole("option", { name: "Nombre, de la A a la Z" }).click();
    await expect(cards.first()).toContainText("invoice.pdf");
    await expect(cards.nth(1)).toContainText("storefront.png");
    await page.getByRole("combobox", { name: "Proyecto" }).click();
    await page.getByRole("option", { name: "Acme" }).click();
    await expect(cards).toHaveCount(1);

    // A card opens the file live; back returns to the list, and the chat is one button away.
    await cards.first().getByRole("button", { name: "storefront.png" }).click();
    const preview = page.getByRole("region", { name: "storefront.png" });
    await expect(preview.locator(".sharedf__stage img")).toBeVisible();
    await expect(cards.first()).toBeHidden();
    await preview.getByRole("button", { name: "Archivos" }).click();
    await expect(cards.first()).toBeVisible();
    await cards.first().getByRole("button", { name: "storefront.png" }).click();
    await preview.getByRole("button", { name: "Copiar ruta" }).hover();
    await expect(page.locator(".apx-tooltip[data-open]")).toHaveText("Copiar ruta");
    await preview.getByRole("button", { name: "Ir al chat" }).click();
    const row = page.locator(`.transcript__row[data-msg="${shared.id}"]`);
    await expect(row).toBeInViewport();
    await expect(page.locator(".transcript").getByText("Launch note 40", { exact: true })).not.toBeInViewport();
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
