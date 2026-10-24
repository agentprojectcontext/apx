import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("nota voz muestra volumen real, conserva audio y texto, reproduce después de recargar", async ({
  page,
  context,
}) => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "Revisá publicaciones duplicadas" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({ port, llm: scriptedLlm(() => say("Duplicates checked")) });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("services.set", {
      id: "ears",
      service: {
        kind: "transcription",
        dialect: "whisper-local",
        label: "Transcription",
        enabled: true,
        needs_key: false,
        base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      },
    });
    await context.grantPermissions(["microphone"], { origin: env.core.url });
    // Live words need whisper.cpp on the machine running the test: the core's answer is stood in for.
    await page.route("**/rpc/media.listen", (route) =>
      route.fulfill({ json: { ok: true, result: { text: "Revisá publicaciones", live: true } } }),
    );
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await expect(input).toBeVisible();
    await page.getByRole("button", { name: "Dictar", exact: true }).click();
    await expect(page.getByText("Grabando", { exact: true })).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
    await expect
      .poll(() =>
        page
          .locator(".voice-recording__bars > span")
          .evaluateAll((bars) =>
            bars.some((bar) => Number((bar as HTMLElement).style.transform.match(/scaleY\(([^)]+)/)?.[1]) > 0.2),
          ),
      )
      .toBe(true);
    await expect(page.locator(".voice-recording__time")).not.toHaveText("0:00");
    await expect(page.locator(".voice-recording__heard")).toHaveText("Revisá publicaciones");
    await expect(input).toHaveValue("");
    await page.screenshot({ path: "/tmp/apx-voice-recording.png" });
    await page.getByRole("button", { name: "Terminar de dictar", exact: true }).click();
    await expect(input).toHaveValue("Revisá publicaciones duplicadas");
    await expect(page.locator(".voice-recording__heard")).toHaveCount(0);
    await expect(page.locator(".attchip.is-audio")).toBeVisible();
    await expect(page.locator(".transcript__row")).toHaveCount(0);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript").getByText("Duplicates checked", { exact: true })).toBeVisible();
    await expect(page.getByText("Revisá publicaciones duplicadas", { exact: true })).toBeVisible();
    const player = page.getByRole("button", { name: "Reproducir nota de voz", exact: true });
    await expect(player).toBeEnabled();
    await player.click();
    await expect(page.getByRole("button", { name: "Pausar nota de voz", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pausar nota de voz", exact: true }).click();
    await page.reload();
    await expect(page.getByText("Revisá publicaciones duplicadas", { exact: true })).toBeVisible();
    await expect(player).toBeEnabled();
    await page.screenshot({ path: "/tmp/apx-voice-message.png" });
    const thread = await env.client.call("threads.get", { thread: "home" });
    expect(thread.messages.filter((m) => m.author.kind === "user")).toHaveLength(1);
    expect(thread.messages.find((m) => m.author.kind === "user")?.parts.some((p) => p.type === "audio")).toBe(true);
    const note = thread.messages.find((m) => m.author.kind === "user")?.parts.find((p) => p.type === "audio");
    expect(note?.type).toBe("audio");
    if (note?.type !== "audio") throw new Error("Missing recording");
    const recording = await env.client.call("media.get", { id: note.media_id });
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Attached.webm",
        mimeType: recording.mime,
        buffer: Buffer.from(recording.data, "base64"),
      });
    await expect(input).toHaveValue("Revisá publicaciones duplicadas");
    await expect(page.locator(".attchip.is-audio")).toBeVisible();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript__files .audiopart")).toHaveCount(2);
    await expect(page.getByText("Revisá publicaciones duplicadas", { exact: true })).toHaveCount(2);
    await page.reload();
    await expect(page.locator(".transcript__files .audiopart")).toHaveCount(2);
    await expect(player.first()).toBeEnabled();
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
