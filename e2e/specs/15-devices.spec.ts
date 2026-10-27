// Devices: the panel shows a one-time code (and says when this core cannot be reached from a phone); a phone trades
// it for a key of its own, shows up in the list, and removing it cuts only that key.
import { expect, open, rpc, test } from "./kit.ts";

const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;

test("a phone pairs with the panel's code and is listed; removing it cuts its key", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("dispositivos");
  await page.getByRole("option", { name: /Dispositivos/ }).click();
  await expect(page.getByText("Conexiones", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conexión" })).toBeVisible();
  await expect(page.getByText("Todavía no hay dispositivos vinculados.")).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e/.out/devices.png" });
  const connection = await page.getByRole("heading", { name: "Conexión" }).boundingBox();
  const empty = await page.getByText("Todavía no hay dispositivos vinculados.").boundingBox();
  expect(connection && empty && connection.y > empty.y).toBeTruthy();
  const badge = await page.locator(".access__status .apx-badge").boundingBox();
  const check = await page.getByRole("button", { name: "Revisar", exact: true }).boundingBox();
  expect(badge && check && Math.abs(badge.y + badge.height / 2 - check.y - check.height / 2) < 2).toBeTruthy();
  const heading = await page.getByRole("heading", { name: "Dispositivos vinculados" }).boundingBox();
  const button = await page.getByRole("button", { name: "Vincular un dispositivo" }).boundingBox();
  expect(heading && button && Math.abs(heading.y - button.y) < 20).toBeTruthy();
  await page.getByRole("button", { name: "Vincular un dispositivo" }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".devices__code")).toBeHidden();
  await page.getByRole("button", { name: "Vincular un dispositivo" }).click();
  // The sandbox listens only on this computer: the panel says a phone cannot reach it yet.
  await expect(page.getByText("Tu teléfono todavía no llega a este core")).toBeVisible();
  const code = (await page.locator(".devices__code").textContent()) ?? "";
  expect(code).toMatch(/^[2-9A-Z]{8}$/);

  // The phone: no key at all, only the code.
  const res = await fetch(`${core}/rpc/devices.pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `pair-${Date.now()}` },
    body: JSON.stringify({ code, name: "Teléfono de prueba", platform: "android" }),
  });
  const body = (await res.json()) as { ok: boolean; result: { token: string } };
  expect(body.ok).toBe(true);

  await expect(page.getByText("Teléfono de prueba", { exact: true })).toBeVisible();
  // The code was used: the QR goes away on its own and says so.
  await expect(page.locator(".devices__code")).toBeHidden();
  await expect(page.getByText("Vinculado: Teléfono de prueba")).toBeVisible();
  await expect(page.getByText("Android", { exact: true })).toBeVisible();
  // Manual push configuration stays separate from device identity and is optional.
  await expect(page.getByRole("textbox", { name: "Dirección de push para Teléfono de prueba" })).toBeHidden();
  await page.getByText("Configurar notificaciones", { exact: true }).click();
  await expect(page.getByText("Dirección de notificaciones (opcional)", { exact: true })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) {
    await page.locator(".devices__card").screenshot({ path: "e2e/.out/device-notifications.png" });
  }
  // A phone without Expo push takes an ntfy address, set here.
  await page
    .getByRole("textbox", { name: "Dirección de push para Teléfono de prueba" })
    .fill("https://ntfy.example.com/apx-e2e");
  await page.getByRole("button", { name: "Usar para push" }).click();
  await expect(page.getByText("Push (ntfy)")).toBeVisible();
  await page.getByRole("button", { name: "Quitar Teléfono de prueba" }).click();
  await expect(page.getByText("Teléfono de prueba", { exact: true })).toBeHidden();
  expect((await rpc<{ devices: unknown[] }>("devices.list")).devices).toEqual([]);
});

test("the account menu opens this chat on the phone: its dialog loads when asked and closes", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Abrir en el teléfono" }).click();
  const dialog = page.getByRole("dialog", { name: "Abrir en el teléfono" });
  // Only reachable from this computer, the sandbox says why there is no QR instead of showing one.
  await expect(dialog.getByText("Tu teléfono todavía no llega a este core")).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar" }).last().click();
  await expect(dialog).toBeHidden();
});

test("who may reach this APX: the local network is saved for the next start, and this computer only undoes it", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("dispositivos");
  await page.getByRole("option", { name: /Dispositivos/ }).click();
  await expect(page.getByRole("heading", { name: "Conexión" })).toBeVisible();
  await page.getByRole("radio", { name: "Red local" }).click();
  // The sandbox core has no supervisor: the choice waits for its next start.
  await expect(page.getByText(/se aplica cuando el core vuelva a arrancar/)).toBeVisible();
  expect((await rpc<{ saved: string }>("access.get", {})).saved).toBe("lan");
  await page.getByRole("radio", { name: "Solo esta compu" }).click();
  await expect(page.getByText(/se aplica cuando el core vuelva a arrancar/)).toBeHidden();
  expect((await rpc<{ saved: string }>("access.get", {})).saved).toBe("local");
});

test("Tailscale status refreshes while Devices remains open", async ({ page }) => {
  let connected = false;
  let reads = 0;
  await page.route("**/rpc/access.get", async (route) => {
    reads++;
    await route.fulfill({
      json: {
        ok: true,
        result: {
          mode: "local",
          saved: "local",
          restart_needed: false,
          urls: [],
          token_set: false,
          tailscale: { installed: true, connected },
        },
      },
    });
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("dispositivos");
  await page.getByRole("option", { name: /Dispositivos/ }).click();
  await expect(page.getByText("Desconectado", { exact: true })).toBeVisible();
  connected = true;
  await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(reads).toBeGreaterThan(1);
  connected = false;
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  await expect(page.getByText("Desconectado", { exact: true })).toBeVisible();
});

test("an older status response cannot undo an access change", async ({ page }) => {
  let reads = 0;
  let release: (() => void) | undefined;
  const stale = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = {
    mode: "local",
    saved: "local",
    restart_needed: false,
    urls: [],
    token_set: false,
    tailscale: { installed: true, connected: false },
  };
  await page.route("**/rpc/access.get", async (route) => {
    const snapshot = { ...state };
    const held = ++reads === 2;
    if (held) await stale;
    await route.fulfill({
      headers: held ? { "x-e2e-stale": "1" } : {},
      json: { ok: true, result: snapshot },
    });
  });
  await page.route("**/rpc/access.set", async (route) => {
    state.mode = "lan";
    state.saved = "lan";
    await route.fulfill({
      json: { ok: true, result: { ...state, mode: "lan", saved: "lan", restarting: false } },
    });
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("dispositivos");
  await page.getByRole("option", { name: /Dispositivos/ }).click();
  await expect(page.getByText("Desconectado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  // Further reads see the new mode, but the held response keeps the old snapshot.
  await page.getByRole("radio", { name: "Red local" }).click();
  await expect(page.getByRole("radio", { name: "Red local" })).toBeChecked();
  const response = page.waitForResponse((r) => r.headers()["x-e2e-stale"] === "1");
  release?.();
  await response;
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.getByRole("radio", { name: "Red local" })).toBeChecked();
});
