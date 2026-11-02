// Storage: Settings › Storage shows what APX keeps by area and frees only what APX makes again (caches, old logs),
// saying first how much; a disk running out shows a corner card that leads there.
import fs from "node:fs";
import path from "node:path";
import { expect, open, openSettings, rpc, test, world } from "./kit.ts";

const MB = 1024 * 1024;

function write(home: string, rel: string, bytes: number, ageDays = 0): string {
  const p = path.join(home, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  const at = (Date.now() - ageDays * 86_400_000) / 1000;
  fs.utimesSync(p, at, at);
  return p;
}

test("the owner sees APX's storage by area and frees caches, never a chat's files", async ({ page }) => {
  await rpc("setup.finish");
  const { home } = await world.info();
  const poster = write(home, "media/posters/e2e-storage.jpg", 2 * MB);
  const work = write(home, "codex-images/e2e-old.png", MB, 3);
  const chatFile = write(home, "media/2026-01-01/e2e-storage.jpg", 2 * MB, 400);
  // Measured fresh, so the screen counts what was just written.
  await rpc("storage.usage", { refresh: true });

  await open(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("button", { name: "Almacenamiento" }).click();
  await expect(dialog.getByRole("heading", { name: "Almacenamiento" })).toBeVisible();
  const areas = dialog.getByTestId("storage-areas");
  await expect(areas.getByText("Caché y archivos temporales")).toBeVisible({ timeout: 15_000 });
  await expect(areas.getByText("Chats, memoria y archivos")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Disco" })).toBeVisible();

  // The button says how much it frees before it is pressed.
  const free = dialog.getByRole("button", { name: /^Liberar \d/ });
  await expect(free).toBeVisible();
  await free.click();
  await expect(page.getByText(/^Se liberaron/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "No hay nada para liberar" })).toBeDisabled({ timeout: 15_000 });
  expect(fs.existsSync(poster)).toBe(false);
  expect(fs.existsSync(work)).toBe(false);
  expect(fs.existsSync(chatFile)).toBe(true);
});

test.describe("a disk running out", () => {
  test.use({ diskWarning: true });

  test("shows a corner card that opens Settings › Storage, closed for the session", async ({ page }) => {
    await rpc("setup.finish");
    const gb = 1024 ** 3;
    await page.route("**/rpc/storage.status", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: { free_bytes: 1.2 * gb, total_bytes: 256 * gb, low: true, threshold_bytes: 5 * gb },
        },
      }),
    );
    await open(page);
    const corner = page.getByRole("complementary", { name: "Novedades e invitaciones" });
    const card = corner.locator('[data-card="disk"]');
    await expect(card.getByText("Tu disco está casi lleno")).toBeVisible();
    await expect(card.getByText(/Quedan 1\.2 GB/)).toBeVisible();
    await card.getByRole("button", { name: "Ver almacenamiento" }).click();
    const dialog = page.getByRole("dialog", { name: "Configuración" });
    await expect(dialog.getByRole("heading", { name: "Almacenamiento" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(dialog).toHaveCount(0);

    // Still low: the card stays until it is closed, and closed it stays away for this session.
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Cerrar" }).click();
    await expect(card).toHaveCount(0);
  });

  test("on a phone it is a strip under the top bar that opens the same screen", async ({ page }) => {
    await rpc("setup.finish");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route("**/rpc/storage.status", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            free_bytes: 900 * 1024 ** 2,
            total_bytes: 256 * 1024 ** 3,
            low: true,
            threshold_bytes: 5 * 1024 ** 3,
          },
        },
      }),
    );
    await open(page);
    const strip = page.getByTestId("disk-banner");
    await expect(strip).toContainText("Disco casi lleno: quedan 900 MB");
    await strip.getByRole("button", { name: "Revisar" }).click();
    const dialog = page.getByRole("dialog", { name: "Configuración" });
    await expect(dialog.getByRole("heading", { name: "Almacenamiento" })).toBeVisible();
    // The section opened is in view in the row of sections.
    await expect(dialog.getByRole("button", { name: "Almacenamiento" })).toBeInViewport();
  });
});
