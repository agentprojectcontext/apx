// Storage: Settings › Storage shows what APX keeps by area and frees only what APX makes again (caches, old logs),
// saying first how much; a disk running out shows a corner card that leads there.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { removeDir, tempDir } from "../../apps/core/src/testkit/platform.ts";
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

test("the owner compacts the chats' file after confirming, and a copy is kept in Backups first", async ({ page }) => {
  await rpc("setup.finish");
  const { home } = await world.info();
  const copies = () =>
    fs.existsSync(path.join(home, "backups"))
      ? fs.readdirSync(path.join(home, "backups")).filter((n) => /^apx-before-compact-\d{8}-\d{6}\.db$/.test(n))
      : [];
  const before = copies().length;

  await open(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("button", { name: "Almacenamiento" }).click();
  await expect(dialog.getByText("Achicar el archivo de chats")).toBeVisible();
  await dialog.getByRole("button", { name: "Compactar" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Compactar el archivo de chats?" });
  await expect(confirm).toBeVisible();
  // Cancelled, nothing runs.
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toHaveCount(0);
  expect(copies().length).toBe(before);

  await dialog.getByRole("button", { name: "Compactar" }).click();
  await page
    .getByRole("dialog", { name: "¿Compactar el archivo de chats?" })
    .getByRole("button", { name: "Compactar" })
    .click();
  await expect(page.getByText(/^Compactado: .+ Se guardó una copia en Copias de seguridad\.$/)).toBeVisible({
    timeout: 30_000,
  });
  expect(copies().length).toBe(before + 1);
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

/** Answers storage.status as the test says: low until `room()` is called. */
async function diskStatus(page: Page) {
  const gb = 1024 ** 3;
  let free = 4.3 * gb;
  await page.route("**/rpc/storage.status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: { free_bytes: free, total_bytes: 256 * gb, low: free < 5 * gb, threshold_bytes: 5 * gb },
      },
    }),
  );
  return {
    room: () => {
      free = 40 * gb;
    },
  };
}

test.describe("one by one", () => {
  test.use({ diskWarning: true });

  test("the owner deletes an agents' computer once it is off, and a backup; the disk mark goes when there is room", async ({
    page,
  }) => {
    const home = tempDir("apx-storage-items-").path;
    const vmDir = path.join(home, "computer", "lima", "computer");
    write(home, "computer/lima/computer/disk", 3 * MB);
    write(home, "computer/lima/computer/lima.yaml", 1024);
    write(home, "labs/apx-vm-lab-demo/lima/apx-lab/disk", 2 * MB);
    const backup = write(home, "backups/apx-before-reimport.db", MB, 30);
    const env = write(home, "backups/core.env", 100);
    let running = true;
    const lifecycle = createVmLifecycle({
      supported: true,
      installed: () => fs.existsSync(path.join(vmDir, "lima.yaml")),
      running: async () => running,
      prepare: async () => {
        running = true;
      },
      stop: async () => {
        running = false;
      },
      appearance: async () => {},
      remove: async () => {
        await removeDir(vmDir);
      },
    });
    const core = await startCore({
      home,
      llm: scriptedLlm(async () => say("ok")),
      computer: { limaHome: path.join(home, "computer", "lima"), instance: "computer", lifecycle },
    });
    try {
      await core.client.call("setup.finish", {});
      const disk = await diskStatus(page);
      await page.goto(`${core.core.url}/`);
      await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();

      // Closing the low-disk card leaves a disk mark beside help, which opens Settings › Storage.
      const corner = page.getByRole("complementary", { name: "Novedades e invitaciones" });
      await corner.locator('[data-card="disk"]').getByRole("button", { name: "Cerrar" }).click();
      const mark = page.getByRole("button", { name: "Disco casi lleno: quedan 4.3 GB" });
      await expect(mark).toBeVisible();
      await mark.click();
      const dialog = page.getByRole("dialog", { name: "Configuración" });
      await expect(dialog.getByRole("heading", { name: "Almacenamiento" })).toBeVisible();

      // The agents' computers, each with its size and state; the one on is turned off before it can go.
      await dialog.getByRole("button", { name: "Computadoras de los agentes" }).click();
      const computers = dialog.getByTestId("storage-computers");
      const agents = computers.getByRole("listitem").filter({ hasText: "La computadora de tus agentes" });
      await expect(agents).toContainText("Encendida");
      await expect(agents).toContainText("Apagala para poder borrarla.");
      await expect(agents.getByRole("button", { name: /^Borrar/ })).toHaveCount(0);
      const lab = computers
        .getByRole("listitem")
        .filter({ hasText: "Computadora de prueba que quedó: apx-vm-lab-demo" });
      await expect(lab).toContainText("Apagada");
      await agents.getByRole("button", { name: "Apagar" }).click();
      await expect(agents).toContainText("Apagada", { timeout: 15_000 });

      // Deleting asks first, saying what is lost and that it is set up again next time.
      await agents.getByRole("button", { name: /^Borrar/ }).click();
      const confirm = page.getByRole("dialog", { name: "¿Borrar la computadora de tus agentes?" });
      await expect(confirm).toContainText("Se pierde todo lo que tus agentes instalaron o guardaron adentro");
      await expect(confirm).toContainText("Se vuelve a preparar desde cero la próxima vez que un agente la necesite.");
      await confirm.getByRole("button", { name: "Cancelar" }).click();
      await expect(confirm).toHaveCount(0);
      expect(fs.existsSync(vmDir)).toBe(true);
      await agents.getByRole("button", { name: /^Borrar/ }).click();
      await confirm.getByRole("button", { name: "Borrar" }).click();
      await expect(page.getByText(/^Computadora borrada\. Se liberaron/)).toBeVisible();
      await expect(agents).toHaveCount(0);
      await expect(lab).toBeVisible();
      expect(fs.existsSync(vmDir)).toBe(false);

      // A backup copy, by its date; core.env is never one. Once there is room, the mark goes by itself.
      await dialog.getByRole("button", { name: "Copias de seguridad" }).click();
      const backups = dialog.getByTestId("storage-backups");
      await expect(backups.getByRole("listitem")).toHaveCount(1);
      await expect(backups).not.toContainText("core.env");
      await expect(page.getByTestId("disk-mark")).toBeVisible();
      disk.room();
      await backups.getByRole("button", { name: /^Borrar/ }).click();
      const sure = page.getByRole("dialog", { name: /^¿Borrar la copia del/ });
      await expect(sure).toContainText("se borra para siempre");
      await sure.getByRole("button", { name: "Borrar" }).click();
      await expect(page.getByText(/^Copia borrada\. Se liberaron/)).toBeVisible();
      await expect(dialog.getByText("No hay copias de seguridad.")).toBeVisible();
      expect(fs.existsSync(backup)).toBe(false);
      expect(fs.existsSync(env)).toBe(true);
      await dialog.getByRole("button", { name: "Cerrar" }).first().click();
      await expect(page.getByTestId("disk-mark")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.goto("about:blank");
      await core.core.close();
      await core.cleanup();
    }
  });
});
