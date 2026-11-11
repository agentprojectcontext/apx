// A project's Files tab: the app's Files screen kept to the project, by kind and with its artifacts; the old Artifacts
// and Files links land on Files and Directory.
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("a project's Files shows its own files by kind and its artifacts; old links reach Files and Directory", async ({
  page,
}) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({ port, llm: scriptedLlm(() => say("Ok")) });
  try {
    await env.client.call("setup.finish", {});
    const { store } = env.core;
    const folder = path.join(env.home, "work", "acme");
    fs.mkdirSync(folder, { recursive: true });
    store.projects.upsert({ id: "p_acme", name: "Acme", path: folder });
    store.projects.upsert({ id: "p_globex", name: "Globex" });
    const launch = store.threads.create({
      kind: "loose",
      title: "Launch",
      agent_ids: ["superagent"],
      project_id: "p_acme",
    });
    const elsewhere = store.threads.create({
      kind: "loose",
      title: "Globex brief",
      agent_ids: ["superagent"],
      project_id: "p_globex",
    });
    const upload = async (name: string, mime: string, data: Buffer) =>
      (await env.client.call("media.upload", { name, mime, data: data.toString("base64") })).media;
    const photo = await upload("storefront.png", "image/png", PNG);
    const pdf = await upload("invoice.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF"));
    const brief = await upload("globex-brief.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF"));
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 9, 0, s)).toISOString();
    const file = (m: { id: string; mime: string; bytes: number }, name: string) =>
      ({ type: "file", media_id: m.id, mime: m.mime, name, bytes: m.bytes }) as const;
    store.messages.add({
      thread_id: launch.id,
      author: { kind: "user" },
      parts: [{ type: "image", media_id: photo.id, mime: photo.mime, alt: "storefront.png" }],
      at: at(0),
      quiet: true,
    });
    store.messages.add({
      thread_id: launch.id,
      author: { kind: "user" },
      parts: [file(pdf, "invoice.pdf")],
      at: at(1),
      quiet: true,
    });
    store.messages.add({
      thread_id: elsewhere.id,
      author: { kind: "user" },
      parts: [file(brief, "globex-brief.pdf")],
      at: at(2),
      quiet: true,
    });
    await env.client.call("surfaces.show", {
      name: "sales-dash",
      title: "Sales dashboard",
      thread: launch.id,
      html: "<main><h1>Sales</h1></main>",
    });

    // A link to the old Artifacts tab opens Files.
    await page.goto(`${env.core.url}/#project=p_acme&tab=artifacts`);
    await expect(page.getByRole("tab", { name: "Archivos" })).toHaveAttribute("aria-selected", "true");
    const cards = page.locator(".sharedf__card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("invoice.pdf");
    await expect(page.getByText("globex-brief.pdf")).toHaveCount(0);
    // The project's header names it: no project picker, and no project on each card.
    await expect(page.getByRole("combobox", { name: "Proyecto", exact: true })).toHaveCount(0);
    await expect(cards.first().locator(".sharedf__line")).not.toContainText("Acme");

    await page.getByRole("radio", { name: /^Imágenes/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("storefront.png");
    await page.getByRole("radio", { name: /^Documentos/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("invoice.pdf");
    await page.getByRole("radio", { name: /^Artefactos/ }).click();
    await expect(cards).toHaveCount(1);
    await cards.first().getByRole("button", { name: "Abrir Sales dashboard" }).click();
    await expect(page.locator(".appscreen__title")).toHaveText("Sales dashboard");

    // A link to the old Files tab opens Directory: the folder and Git, widgets being under Files › Artifacts now.
    await page.goto(`${env.core.url}/#project=p_acme&tab=files`);
    await expect(page.getByRole("tab", { name: "Directorio" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("radio")).toHaveText(["Carpeta", "Git"]);
  } finally {
    // Detach the browser before stopping its core: requests still on their way must not fail the page.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
