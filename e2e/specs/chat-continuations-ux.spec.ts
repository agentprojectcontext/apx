import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const SHOTS = process.env.SHOTS;
const webDist = fileURLToPath(new URL("../../apps/web/dist", import.meta.url));
test.use({ timezoneId: "America/Argentina/Buenos_Aires" });

async function visibleKeyboardFocus(control: Locator) {
  await expect(control).toBeFocused();
  expect(await control.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await expect(control).toHaveCSS("outline-style", "solid");
  await expect(control).toHaveCSS("outline-width", "2px");
  await expect(control).toHaveCSS("outline-offset", "3px");
  const color = await control.evaluate((el) => getComputedStyle(el).outlineColor);
  expect(color).not.toBe("rgba(0, 0, 0, 0)");
  return color;
}

for (const language of ["es", "en"] as const) {
  for (const width of [1280, 390]) {
    test(`${language} at ${width}px: local focus, retry, bounded dates, expiry and private task titles`, async ({
      page,
    }) => {
      const description =
        "Read the report and compare it with the previous one. If the figures have changed, summarize what is different. " +
        "Check whether the new figures are final, and point out anything that still needs to be confirmed.";
      const text =
        language === "es"
          ? {
              scheduled: "Programado",
              cancel: `Cancelar: ${description}`,
              canceled: "Cancelado",
              retry: "No se pudo cancelar. Volvé a intentar.",
              view: "Ver ejecución",
              timeExpired: "No empezó antes de que venciera el plazo.",
              eventExpired: "No terminó «Waiting cycle» antes del plazo.",
              taskBlocked: "Elegí una tarea disponible y pedilo de nuevo.",
            }
          : {
              scheduled: "Scheduled",
              cancel: `Cancel: ${description}`,
              canceled: "Canceled",
              retry: "Couldn't cancel. Try again.",
              view: "View run",
              timeExpired: "It didn't start before the deadline.",
              eventExpired: "“Waiting cycle” didn't finish before the deadline.",
              taskBlocked: "Choose an available task and ask again.",
            };
      let clock = new Date("2026-10-06T02:50:00Z");
      const llm = scriptedLlm(() => say("Read-only simulated task result. No appliance evidence or actions."));
      const env = await startCore({ llm, clock: () => clock, webDist });
      const create = (
        purpose: string,
        condition: { kind: "time"; at: string } | { kind: "task_done"; task: string },
        expires_at = "2026-10-06T03:20:00Z",
      ) => env.client.call("continuations.create", { thread: "home", purpose, condition, expires_at });
      const shot = async (state: string) => {
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `continuation-${language}-${width}-${state}.png`) });
      };
      try {
        await env.client.call("setup.finish", {});
        env.core.store.settings.write("notices", {
          ...env.core.store.settings.read("notices"),
          channel: "none",
          quiet_from: "00:00",
          quiet_to: "23:59",
        });
        const task = await env.client.call("tasks.create", { title: "Simulated cycle" });
        await create(description, { kind: "time", at: "2026-10-06T03:10:00Z" });
        const event = await create("Read the cycle result", { kind: "task_done", task: task.id });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.addInitScript((lang) => {
          if (location.protocol === "http:") localStorage.setItem("apx.prefs", JSON.stringify({ language: lang }));
        }, language);
        const chunk = "**/assets/ContinuationNotice-*.js";
        const held = Promise.withResolvers<void>();
        await page.route(chunk, async (route) => {
          await held.promise;
          await route.continue();
        });
        try {
          await page.goto(`${env.core.url}/#thread=home`, { waitUntil: "domcontentloaded" });
          await expect(page.getByText(language === "es" ? "Cargando seguimiento…" : "Loading follow-up…")).toHaveCount(
            2,
          );
          await expect(page.getByText(description, { exact: false })).toHaveCount(0);
        } finally {
          held.resolve();
        }
        const receipts = page.locator(".continuation-notice");
        await expect(receipts).toHaveCount(2);
        const timer = receipts.first();
        const status = timer.locator(".continuation-notice__status");
        const cancel = timer.getByRole("button", { name: text.cancel, exact: true });
        const purpose = timer.getByText(description, { exact: true });
        await expect(timer).toContainText(text.scheduled);
        await expect(cancel).toBeVisible();
        await expect(purpose).toBeHidden();
        await expect(status).toHaveAttribute("aria-expanded", "false");
        const statusBox = await status.boundingBox();
        const buttonBox = await cancel.boundingBox();
        expect(statusBox).not.toBeNull();
        expect(buttonBox).not.toBeNull();
        if (statusBox && buttonBox) {
          expect(buttonBox.x).toBeGreaterThanOrEqual(statusBox.x + statusBox.width);
          expect(Math.abs(buttonBox.y - statusBox.y)).toBeLessThan(6);
        }
        await shot("pending");
        await status.press("Enter");
        await expect(status).toHaveAttribute("aria-expanded", "true");
        await expect(purpose).toBeVisible();
        await expect(
          timer.getByText(language === "es" ? /^El 6 de oct de 2026 a las/ : /^Oct 6, 2026 at/),
        ).toBeVisible();
        await expect(timer).toContainText(/(0:10|12:10|00:10)/);
        await expect(timer).toContainText(/(ART|GMT-3)/);
        await shot("expanded");
        await status.press("Space");
        await expect(purpose).toBeHidden();
        await page.keyboard.press("Tab");
        const focusColor = await visibleKeyboardFocus(cancel);
        await shot("cancel-tab");
        await page.route("**/rpc/continuations.cancel", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: { code: "internal", message: "Temporary test failure" } }),
          }),
        );
        await cancel.press("Enter");
        await expect(timer.getByRole("alert")).toHaveText(text.retry);
        expect(await visibleKeyboardFocus(cancel)).toBe(focusColor);
        await shot("cancel-retry");
        await page.unroute("**/rpc/continuations.cancel");
        await cancel.press("Enter");
        await expect(status).toHaveText(text.canceled);
        await expect(status).toHaveAttribute("aria-expanded", "false");
        expect(await visibleKeyboardFocus(status)).toBe(focusColor);
        await shot("canceled");
        await env.client.call("tasks.close", { task: task.id, state: "done" });
        env.core.scheduler.tick();
        const view = receipts.nth(1).getByRole("button", { name: text.view, exact: true });
        await expect(view).toBeVisible();
        await expect(status).toBeFocused();
        await page.keyboard.press("Tab");
        await visibleKeyboardFocus(receipts.nth(1).locator(".continuation-notice__status"));
        await page.keyboard.press("Tab");
        expect(await visibleKeyboardFocus(view)).toBe(focusColor);
        await shot("view-tab");
        await view.press("Enter");
        const result = page.locator(
          `[data-msg="${env.core.store.messages.ofRun("home", env.core.store.continuations.get(event.id)?.value.run_id ?? "")[0]?.id}"]`,
        );
        expect(await visibleKeyboardFocus(result)).toBe(focusColor);
        await expect(result).toContainText("Read-only simulated task result");
        await shot("result");
        env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
        const moved = await env.client.call("tasks.create", { title: "Shared task" });
        await create("Read the shared task", { kind: "task_done", task: moved.id });
        await env.client.call("tasks.update", {
          task: moved.id,
          project: "northwind",
          title: "Northwind confidential title",
        });
        env.core.scheduler.tick();
        await expect(receipts.nth(2)).toContainText(text.taskBlocked);
        await expect(page.getByText("Northwind confidential title", { exact: false })).toHaveCount(0);
        const waiting = await env.client.call("tasks.create", { title: "Waiting cycle" });
        await create("Wait for the cycle", { kind: "task_done", task: waiting.id });
        await create("Wait for the time", { kind: "time", at: "2026-10-06T03:10:00Z" });
        clock = new Date("2026-10-06T03:21:00Z");
        env.core.scheduler.tick();
        await expect(receipts.nth(3)).toContainText(text.eventExpired);
        await expect(receipts.nth(4)).toContainText(text.timeExpired);
        await expect(page.locator(".transcript")).not.toContainText("15 minutos");
        await expect(page.locator(".transcript")).not.toContainText("15 minutes");
        await receipts.last().scrollIntoViewIfNeeded();
        await shot("expired-blocked");
        await page.reload();
        await expect(receipts.nth(3)).toContainText(text.eventExpired);
        await expect(receipts.nth(4)).toContainText(text.timeExpired);
      } finally {
        await page.goto("about:blank");
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}
