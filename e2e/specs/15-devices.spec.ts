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

  await expect(page.getByText("Teléfono de prueba")).toBeVisible();
  await expect(page.getByText("Android", { exact: true })).toBeVisible();
  // A phone without Expo push takes an ntfy address, set here.
  await page
    .getByRole("textbox", { name: "Dirección de push para Teléfono de prueba" })
    .fill("https://ntfy.example.com/apx-e2e");
  await page.getByRole("button", { name: "Usar para push" }).click();
  await expect(page.getByText("Push (ntfy)")).toBeVisible();
  await page.getByRole("button", { name: "Quitar Teléfono de prueba" }).click();
  await expect(page.getByText("Teléfono de prueba")).toBeHidden();
  expect((await rpc<{ devices: unknown[] }>("devices.list")).devices).toEqual([]);
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
  await expect(page.getByRole("heading", { name: "Acceso desde otros equipos" })).toBeVisible();
  await page.getByRole("radio", { name: "Red local" }).click();
  // The sandbox core has no supervisor: the choice waits for its next start.
  await expect(page.getByText(/se aplica cuando el core vuelva a arrancar/)).toBeVisible();
  expect((await rpc<{ saved: string }>("access.get", {})).saved).toBe("lan");
  await page.getByRole("radio", { name: "Solo esta compu" }).click();
  await expect(page.getByText(/se aplica cuando el core vuelva a arrancar/)).toBeHidden();
  expect((await rpc<{ saved: string }>("access.get", {})).saved).toBe("local");
});
