import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import type { Tool } from "../../apps/core/src/tools/types.ts";
import { expect, test } from "./kit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\nreceipt\n%%EOF");

test("arrastrar MP4 5,3 MB y PDF grande permite enviar; rechazo muestra motivo completo", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({ port, llm: scriptedLlm(() => say("Files received")) });
  try {
    await env.client.call("setup.finish", {});
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await expect(input).toBeVisible();
    await input.fill("Keep my attachments");
    const tooLargeName = "product-launch-reel-final-review-version-with-captions.mp4";
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: tooLargeName,
        mimeType: "video/mp4",
        buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
      });
    const error = page.getByRole("alert");
    await expect(error).toHaveText(`${tooLargeName} pasa los 20 MB`);
    expect(await error.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: `Quitar ${tooLargeName}`, exact: true }).click();
    await expect(input).toHaveValue("Keep my attachments");

    const clip = fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/media/preview.mp4"));
    const video = Buffer.alloc(5_333_561);
    clip.copy(video);
    video.writeUInt32BE(video.length - clip.length, clip.length);
    video.write("free", clip.length + 4);
    await page.evaluate((data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "clip.mp4"));
      const composer = document.querySelector(".chat__composer");
      if (!composer) throw new Error("Missing composer");
      composer.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, video.toString("base64"));
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "report.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024, 32)]),
      });
    await expect(page.locator(".attchip.is-loading")).toHaveCount(0);
    await expect(page.locator(".attchip.is-error")).toHaveCount(0);
    await expect(page.locator(".attchip")).toHaveCount(2);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript").getByText("Files received", { exact: true })).toBeVisible();
    await page.reload();
    const player = page.locator('video[aria-label="clip.mp4"]');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((el) => (el as HTMLVideoElement).readyState)).toBeGreaterThan(0);
    await player.evaluate((el) => (el as HTMLVideoElement).play());
    await expect.poll(() => player.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await player.evaluate((el) => (el as HTMLVideoElement).pause());
    const download = page.waitForEvent("download");
    await page
      .locator(".mediacarousel__card", { hasText: "clip.mp4" })
      .getByRole("button", { name: "Descargar" })
      .click();
    const downloaded = await (await download).path();
    expect(downloaded).toBeTruthy();
    expect(fs.readFileSync(downloaded ?? "")).toEqual(video);
    await expect(page.getByRole("button", { name: /^report.pdf/ })).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

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
    await env.cleanup();
  }
});
