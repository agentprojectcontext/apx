import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("image generation shows inline cubes, real single/multiple results, and clears on failure or cancel", async ({
  page,
}, testInfo) => {
  const pending: http.ServerResponse[] = [];
  const requests: string[] = [];
  const api = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    req.resume();
    req.on("end", () => {
      if (req.url === "/v1/images/generations") pending.push(res);
      else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
      }
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({
    port,
    llm: scriptedLlm((_req, { afterTool, said }) =>
      afterTool
        ? say("Image request finished")
        : callTool(`drawing-${said}`, "make_image", {
            prompt: `A green landscape for ${said}`,
            count: said === "two" ? 2 : 1,
          }),
    ),
  });
  const picture = fs.readFileSync(new URL("../fixtures/media/preview.jpg", import.meta.url)).toString("base64");
  try {
    await env.client.call("setup.finish", {});
    // Keep machine-discovered image services from reaching an external account in this isolated flow.
    await env.client.call("services.set", {
      id: "codex",
      service: {
        kind: "image",
        dialect: "codex-images",
        label: "Codex",
        base_url: "http://127.0.0.1:9",
        enabled: false,
        needs_key: false,
      },
    });
    await env.client.call("services.set", {
      id: "images",
      service: {
        kind: "image",
        dialect: "openai-images",
        label: "Image service",
        enabled: true,
        needs_key: false,
        base_url: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
      },
    });
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    const preview = page.getByRole("status", { name: "Generando imágenes" });
    for (const scenario of ["one", "two", "failure", "cancel"]) {
      await input.fill(scenario);
      await page.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(preview).toBeVisible();
      await expect(preview.locator("i")).toHaveCount(25);
      expect(await preview.evaluate((el) => el.closest(".apx-msg"))).toBeNull();
      await expect
        .poll(() => ({ pending: pending.length, requests }), { message: `Image request for ${scenario}` })
        .toEqual({ pending: 1, requests: expect.any(Array) });
      if (scenario === "one") {
        await expect(preview.locator("i").first()).toHaveCSS("animation-name", "image-generation-form");
        await expect
          .poll(() =>
            preview
              .locator("i")
              .nth(12)
              .evaluate((el) => Number(getComputedStyle(el).opacity)),
          )
          .toBeGreaterThan(0.5);
        await page.screenshot({ path: testInfo.outputPath("inline-cubes.png") });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(preview.locator("i").first()).toHaveCSS("animation-name", "none");
        await expect(preview.locator("i").first()).toHaveCSS("opacity", "0.55");
        await page.reload();
        await expect(preview).toBeVisible();
      }
      const res = pending.shift();
      if (!res) throw new Error("Image service was not called");
      if (scenario === "cancel") {
        await env.client.call("threads.cancel", { thread: "home" });
        await expect(preview).toHaveCount(0);
      }
      const failed = scenario === "failure" || scenario === "cancel";
      res.writeHead(failed ? 400 : 200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          failed
            ? { error: { message: "Image request refused" } }
            : {
                data: Array.from({ length: scenario === "two" ? 2 : 1 }, () => ({ b64_json: picture })),
              },
        ),
      );
      await env.settle("home");
      await expect(preview).toHaveCount(0);
      const images = page.locator(".mediagrid img");
      await expect(images).toHaveCount(scenario === "one" ? 1 : 3);
      if (scenario === "one") {
        await expect.poll(() => images.first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(320);
        await expect(page.locator(".mediagrid").first()).toHaveClass(/is-single/);
        const dimensions = await images.first().evaluate((img) => ({
          w: img.clientWidth,
          h: img.clientHeight,
          nw: (img as HTMLImageElement).naturalWidth,
          nh: (img as HTMLImageElement).naturalHeight,
        }));
        expect(dimensions.w / dimensions.h).toBeCloseTo(dimensions.nw / dimensions.nh, 1);
      }
      if (scenario === "two") {
        await images.last().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
    await page.reload();
    await expect(page.locator(".mediagrid img")).toHaveCount(3);
    await expect(page.locator(".image-generation-preview")).toHaveCount(0);
  } finally {
    await testInfo.attach("image-flow", {
      body: JSON.stringify({ requests, chat: await env.client.call("threads.get", { thread: "home" }) }),
      contentType: "application/json",
    });
    for (const response of pending) response.end();
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
