import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { openDisplay } from "../../apps/core/src/engine/display.ts";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test.use({ video: "on" });

async function configureImages(env: Awaited<ReturnType<typeof startCore>>, port: number) {
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
      base_url: `http://127.0.0.1:${port}`,
    },
  });
}

async function assertSingleImage(page: Page, index: number, naturalWidth: number, screenshot: string) {
  const slot = page.locator(".image-generation-preview").nth(index);
  const grid = slot.locator(".mediagrid");
  await expect(slot).toHaveCSS("transition-duration", "0.48s, 0.48s, 0.32s");
  await expect(grid).toHaveClass(/is-single/);
  const image = grid.locator("img");
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(naturalWidth);
  const dimensions = await image.evaluate((img) => ({
    w: img.clientWidth,
    h: img.clientHeight,
    nw: (img as HTMLImageElement).naturalWidth,
    nh: (img as HTMLImageElement).naturalHeight,
  }));
  expect(dimensions.w / dimensions.h).toBeCloseTo(dimensions.nw / dimensions.nh, 1);
  expect(dimensions.h).toBeLessThanOrEqual(420);
  await expect
    .poll(async () => {
      const box = await slot.boundingBox();
      return box ? box.width / box.height : 0;
    })
    .toBeCloseTo(dimensions.nw / dimensions.nh, 1);
  await slot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot });
}

for (const language of ["es", "en"] as const) {
  test(`image generation replaces its inline slot for single/multiple results, failure and cancel (${language})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((language) => {
      // The cleanup navigation to about:blank has no origin storage.
      if (location.protocol === "http:" || location.protocol === "https:")
        localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, language);
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
    const picture = fs
      .readFileSync(process.env.E2E_IMAGE_ARTWORK ?? new URL("../fixtures/media/preview.jpg", import.meta.url))
      .toString("base64");
    const portrait = fs.readFileSync(new URL("../fixtures/media/portrait.jpg", import.meta.url)).toString("base64");
    try {
      await configureImages(env, (api.address() as AddressInfo).port);
      await page.goto(env.core.url);
      const input = page.getByRole("textbox", { name: language === "es" ? /^Escribile a/ : /^Message / });
      const preview = page.getByRole("status", {
        name: language === "es" ? "Generando imágenes" : "Generating images",
      });
      await page.screenshot({ path: testInfo.outputPath("desktop-empty.png") });
      let imageCount = 0;
      let slotCount = 0;
      for (const scenario of ["one", "two", "portrait", "media-error", "failure", "cancel"]) {
        await page.emulateMedia({ reducedMotion: scenario === "two" ? "reduce" : "no-preference" });
        if (scenario === "two") await page.setViewportSize({ width: 390, height: 844 });
        await input.fill(scenario);
        await page.getByRole("button", { name: language === "es" ? "Enviar" : "Send", exact: true }).click();
        await expect(preview).toBeVisible();
        await expect(preview.locator("i")).toHaveCount(25);
        await expect(preview.locator("svg")).toBeVisible();
        await expect(preview.locator("svg")).toHaveAttribute("aria-hidden", "true");
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
          await page.emulateMedia({ reducedMotion: "no-preference" });
        }
        if (scenario === "two") {
          await expect(preview).toHaveCSS("transition-duration", "0s");
          await preview.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath("mobile-cubes-reduced.png") });
        }
        if (scenario === "media-error")
          await page.route(
            "**/rpc/media.get",
            (route) =>
              route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Image unavailable" } } }),
            { times: 1 },
          );
        const originalSlot = await preview.elementHandle();
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
                  data: Array.from({ length: scenario === "two" ? 2 : 1 }, () => ({
                    b64_json: scenario === "portrait" ? portrait : picture,
                  })),
                },
          ),
        );
        await env.settle("home");
        if (scenario === "media-error") {
          const failedSlot = page.locator(".image-generation-preview.is-failed");
          await expect(failedSlot).toHaveText(
            language === "es" ? "No se pudieron cargar las imágenes.Reintentar" : "Could not load the images.Retry",
          );
          await expect(failedSlot.locator(".image-generation-preview__tiles")).toBeHidden();
          expect(await originalSlot?.evaluate((el) => el.isConnected)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath("mobile-media-error.png") });
          await failedSlot.getByRole("button", { name: language === "es" ? "Reintentar" : "Retry" }).click();
          await expect(failedSlot).toHaveCount(0);
        }
        await expect(preview).toHaveCount(0);
        const images = page.locator(".mediagrid img");
        if (!failed) {
          imageCount += scenario === "two" ? 2 : 1;
          slotCount += 1;
        }
        await expect(images).toHaveCount(imageCount);
        if (failed) {
          expect(await originalSlot?.evaluate((el) => el.isConnected)).toBe(false);
          await page.screenshot({ path: testInfo.outputPath(`mobile-${scenario}.png`) });
        }
        if (!failed) {
          expect(await originalSlot?.evaluate((el) => el.isConnected)).toBe(true);
          expect(await originalSlot?.evaluate((el) => el.querySelectorAll(".mediagrid img").length)).toBe(
            scenario === "two" ? 2 : 1,
          );
          expect(await originalSlot?.evaluate((el) => el.querySelector(".apx-msg__avatar"))).toBeNull();
          await expect(page.locator(".image-generation-preview.is-ready")).toHaveCount(slotCount);
          await expect(images.last()).toHaveAttribute("loading", "eager");
        }
        if (scenario === "one") await assertSingleImage(page, 0, 320, testInfo.outputPath("desktop-result.png"));
        if (scenario === "portrait")
          await assertSingleImage(page, 2, 400, testInfo.outputPath("mobile-portrait-result.png"));
        if (scenario === "two") {
          const multiple = page.locator(".image-generation-preview").nth(1);
          await expect
            .poll(() =>
              multiple.evaluate((slot) => {
                const container = slot.getBoundingClientRect();
                return [...slot.querySelectorAll(".mediagrid__tile")].every((tile) => {
                  const box = tile.getBoundingClientRect();
                  return box.width > 0 && box.left >= container.left - 1 && box.right <= container.right + 1;
                });
              }),
            )
            .toBe(true);
          await page.screenshot({ path: testInfo.outputPath("mobile-multiple-result.png") });
          await images.last().click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
        }
      }
      // Exercise the core display's split path deterministically, without depending on harness steering timing.
      const { store } = env.core;
      const run = store.runs.create({
        thread_id: "home",
        agent_id: "superagent",
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Draw while I add a detail" },
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        state: "queued",
      });
      const display = openDisplay(
        store,
        store.messages.add({
          thread_id: "home",
          author: { kind: "agent", id: "superagent" },
          run_id: run.id,
          parts: [{ type: "tool", tool: "make_image", call_id: "segmented", status: "running", title: "Drawing" }],
        }),
      );
      await expect(preview).toBeVisible();
      const splitSlot = await preview.elementHandle();
      store.messages.add({
        thread_id: "home",
        author: { kind: "user" },
        parts: [{ type: "text", text: "Make it green" }],
      });
      const next = display.below();
      const source = store.messages
        .list("home")
        .flatMap((m) => m.parts)
        .find((p) => p.type === "image");
      if (source?.type !== "image") throw new Error("Missing generated picture");
      display.upsert((p) => p.type === "image", { ...source, tool_call_id: "segmented" });
      display.upsert((p) => p.type === "tool", {
        type: "tool",
        tool: "make_image",
        call_id: "segmented",
        status: "ok",
        title: "Drawing",
      });
      store.runs.setState(run, "completed");
      display.close();
      await expect(preview).toHaveCount(0);
      expect(await splitSlot?.evaluate((el) => el.isConnected)).toBe(true);
      expect(await splitSlot?.evaluate((el) => el.querySelectorAll(".mediagrid img").length)).toBe(1);
      await expect(page.locator(`[data-msg="${next.id}"] .mediagrid`)).toHaveCount(0);
      await expect(page.locator(".mediagrid img")).toHaveCount(6);
      await page.screenshot({ path: testInfo.outputPath("mobile-segmented-result.png") });
      const unsafe = store.messages.add({
        thread_id: "home",
        author: { kind: "agent", id: "superagent" },
        run_id: run.id,
        parts: [
          { type: "tool", tool: "make_image", call_id: "unsafe", status: "ok", title: "Drawing" },
          { type: "image", url: "javascript:alert(1)", alt: "Unavailable image", tool_call_id: "unsafe" },
        ],
      });
      const unsafeSlot = page.locator(`[data-msg="${unsafe.id}"] .image-generation-preview`);
      await expect(unsafeSlot).toHaveClass(/is-failed/);
      await expect(unsafeSlot.getByRole("button", { name: language === "es" ? "Reintentar" : "Retry" })).toBeVisible();
      await expect(unsafeSlot.locator("img")).toHaveCount(0);
      store.messages.drop("home", [unsafe.id]);
      const previous = store.messages
        .list("home")
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "image")
        .slice(0, 2);
      for (let i = 0; i < 12; i++) {
        const call = `history-${i}`;
        store.messages.add({
          thread_id: "home",
          author: { kind: "agent", id: "superagent" },
          run_id: run.id,
          parts: [
            { type: "tool", tool: "make_image", call_id: call, status: "ok", title: "Drawing" },
            ...previous.map((p) => ({ ...p, tool_call_id: call })),
          ],
        });
      }
      await page.reload();
      await expect(page.locator(".mediagrid img")).toHaveCount(30);
      await expect(page.locator(".image-generation-preview")).toHaveCount(17);
      await expect(preview).toHaveCount(0);
      const historyImages = page.locator(".mediagrid:not(.is-single) img");
      await expect(historyImages).toHaveCount(26);
      for (const image of await historyImages.all()) await expect(image).toHaveAttribute("loading", "lazy");
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
}
