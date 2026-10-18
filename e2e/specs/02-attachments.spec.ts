import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import type { Tool } from "../../apps/core/src/tools/types.ts";
import { expect, test } from "./kit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\nreceipt\n%%EOF");

test("adjuntos usuario y agente muestran imágenes y descargan archivos después de recargar", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((err) => (err ? reject(err) : resolve())));
  const env = await startCore({
    port,
    llm: scriptedLlm((_req, { afterTool }) =>
      afterTool ? say("Files shown") : callTool("show", "show_attachments", {}),
    ),
    extraTools: [
      {
        name: "show_attachments",
        description: "Show the files from this turn",
        parameters: { type: "object", properties: {} },
        parse: () => ({ ok: true, args: {} }),
        confirm: () => "never",
        effect: "none",
        deadlineMs: 1000,
        title: () => "Files",
        async run(_args, ctx) {
          for (const f of ctx.run.input?.attachments ?? []) {
            ctx.upsertPart(
              (p) => (p.type === "file" || p.type === "image") && p.media_id === f.media_id,
              f.kind === "image"
                ? { type: "image", media_id: f.media_id, mime: f.mime, alt: `Agent copy: ${f.name}` }
                : {
                    type: "file",
                    media_id: f.media_id,
                    mime: f.mime,
                    name: `Agent copy: ${f.name}`,
                    bytes: PDF.length,
                  },
            );
          }
          return "Files displayed";
        },
      } satisfies Tool,
    ],
  });
  try {
    await env.client.call("setup.finish", {});
    const health = await env.client.call("system.health", {});
    expect(health.code_sha).toBeTruthy();
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await expect(input).toBeVisible();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        { name: "ticket.png", mimeType: "image/png", buffer: PNG },
        { name: "receipt.pdf", mimeType: "application/pdf", buffer: PDF },
      ]);
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
    await input.fill("Show attached receipts");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript").getByText("Files shown", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "ticket.png", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Agent copy: ticket.png", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^receipt.pdf/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Agent copy: receipt.pdf/ })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Agent copy: receipt.pdf/ }).click();
    const file = await download;
    const at = await file.path();
    expect(at).toBeTruthy();
    expect(fs.readFileSync(at ?? "")).toEqual(PDF);
    await page.reload();
    await expect(page.getByRole("img", { name: "Agent copy: ticket.png", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Agent copy: receipt.pdf/ })).toBeVisible();
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
