import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("agente adjunta JPG, MP4 y audio: visibles, reproducibles y descargables tras recargar", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm((_req, { said, afterTool }) =>
    afterTool ? say("File attached") : callTool("attach", "send_file", { path: said }),
  );
  const env = await startCore({ port, llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(work, { recursive: true });
    const fixtures = path.resolve(import.meta.dirname, "../fixtures/media");
    for (const name of ["preview.jpg", "preview.mp4", "preview.wav"])
      fs.copyFileSync(path.join(fixtures, name), path.join(work, name));
    await env.client.call("setup.finish", {});
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await expect(input).toBeVisible();
    for (const [i, name] of ["preview.jpg", "preview.mp4", "preview.wav"].entries()) {
      await input.fill(name);
      await page.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(page.locator(".transcript").getByText("File attached", { exact: true })).toHaveCount(i + 1);
    }
    const image = page.getByRole("img", { name: "preview.jpg", exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(320);
    const video = page.locator('video[aria-label="preview.mp4"]');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState)).toBeGreaterThan(0);
    await video.evaluate((el) => (el as HTMLVideoElement).play());
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await video.evaluate((el) => (el as HTMLVideoElement).pause());
    const audio = page.locator('audio[aria-label="preview.wav"]');
    await expect(audio).toBeVisible();
    await audio.evaluate((el) => (el as HTMLAudioElement).play());
    await expect.poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
    await audio.evaluate((el) => (el as HTMLAudioElement).pause());
    for (const name of ["preview.jpg", "preview.mp4", "preview.wav"]) fs.unlinkSync(path.join(work, name));
    // Resolve the image after the other media have mounted, preserving the reload's asynchronous layout.
    await page.route("**/rpc/media.get", async (route) => {
      const response = await route.fetch();
      const { result } = (await response.json()) as { result: { mime: string } };
      if (result.mime.startsWith("image/")) {
        await expect(video).toBeVisible();
        await expect(audio).toBeVisible();
      }
      await route.fulfill({ response });
    });
    await page.reload();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(320);
    await expect(video).toBeVisible();
    await expect(audio).toBeVisible();
    const download = page.waitForEvent("download");
    // A video's card has its own download button, beside its name.
    await page
      .locator(".mediacarousel__card", { hasText: "preview.mp4" })
      .getByRole("button", { name: "Descargar" })
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("preview.mp4");
    const downloaded = await file.path();
    if (!downloaded) throw new Error("Missing downloaded attachment");
    expect(fs.readFileSync(downloaded)).toEqual(fs.readFileSync(path.join(fixtures, "preview.mp4")));
    await page.screenshot({ path: "/tmp/apx-agent-attachments.png", fullPage: true });
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
