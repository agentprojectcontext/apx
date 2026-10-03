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
  await page.getByRole("button", { name: "Quitar Teléfono de prueba" }).click();
  await expect(page.getByText("Teléfono de prueba")).toBeHidden();
  expect((await rpc<{ devices: unknown[] }>("devices.list")).devices).toEqual([]);
});
