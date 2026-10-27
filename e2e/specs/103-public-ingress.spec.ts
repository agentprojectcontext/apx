import { expect, open, rpc, test } from "./kit.ts";

test("public ingress is configurable outside channel settings without exposing the panel", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("dispositivos");
  await page.getByRole("option", { name: /Dispositivos/ }).click();
  await expect(page.getByRole("heading", { name: "Dirección pública", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Endpoints públicos", exact: true })).toBeVisible();
  await expect(page.getByText("Creá un Flow con webhook para registrar un endpoint.", { exact: false })).toBeVisible();
  const health = await rpc<{ code_sha: string }>("system.health");
  expect(health.code_sha).toMatch(/^[a-f0-9]{7,40}$/);
  if (process.env.E2E_EXPECTED_SHA) expect(health.code_sha).toBe(process.env.E2E_EXPECTED_SHA);
  const { port } = await rpc<{ port: number }>("webhooks.get");
  const publicOrigin = `http://127.0.0.1:${port}`;
  expect((await fetch(`${publicOrigin}/`)).status).toBe(404);
  expect((await fetch(`${publicOrigin}/rpc/system.health`, { method: "POST", body: "{}" })).status).toBe(404);
});

test("published widget renders in a real browser without private state or network actions", async ({ browser }) => {
  const surface = await rpc<{ id: string }>("surfaces.show", {
    name: "public-readonly-proof",
    title: "Public page",
    html: '<script src="/_apx/kit@1.js"></script><h1>Read-only proof</h1><p id="state"></p><script>document.getElementById("state").textContent = JSON.stringify(window.APX?.state ?? {});</script>',
  });
  await rpc("surfaces.set_state", { surface: surface.id, patch: { privateMarker: "never-public" } });
  const { share_path } = await rpc<{ share_path: string }>("surfaces.share", { surface: surface.id, shared: true });
  const { port } = await rpc<{ port: number }>("webhooks.get");
  const url = `http://127.0.0.1:${port}${share_path}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Read-only proof" })).toBeVisible();
    expect(await page.locator("#state").textContent()).not.toContain("never-public");
    expect(await page.evaluate(() => typeof (window as unknown as { APX?: unknown }).APX)).toBe("object");
    const blocked = await page.evaluate(async () => {
      try {
        await fetch("/rpc/surfaces.set_state", { method: "POST", body: "{}" });
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
    await rpc("surfaces.share", { surface: surface.id, shared: false });
    expect((await fetch(url)).status).toBe(404);
  } finally {
    await context.close();
    await rpc("surfaces.remove", { surface: surface.id });
  }
});
