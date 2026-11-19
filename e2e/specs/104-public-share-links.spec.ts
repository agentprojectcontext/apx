import { expect, open, rpc, test } from "./kit.ts";

test("the live link opens at the custom public address and never the private panel", async ({ page, context }) => {
  const surface = await rpc<{ id: string }>("surfaces.show", {
    name: "public-link-ui",
    title: "Public link proof",
    html: "<h1>Link proof</h1>",
  });
  const { share_path } = await rpc<{ share_path: string }>("surfaces.share", { surface: surface.id, shared: true });
  await context.route("https://public.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Public target</h1>",
    }),
  );
  try {
    await rpc("webhooks.set", { mode: "custom", url: "https://public.example.com" });
    await open(page, `#app=${surface.id}`);
    await page.getByRole("button", { name: "Compartido", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Quién lo puede ver" })).toHaveText(/En vivo desde esta compu/);
    await expect(page.getByText(`public.example.com${share_path}`, { exact: true })).toBeVisible();
    const popupReady = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Abrir enlace", exact: true }).click();
    const popup = await popupReady;
    await expect(popup).toHaveURL(`https://public.example.com${share_path}`);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
    await page.keyboard.press("Escape");
    await rpc("webhooks.set", { mode: "off" });
    await page.getByRole("button", { name: "Compartido", exact: true }).click();
    await expect(page.getByText("Copiar y abrir necesitan una dirección pública", { exact: false })).toBeVisible();
  } finally {
    await rpc("webhooks.set", { mode: "off" });
    await rpc("surfaces.remove", { surface: surface.id });
  }
});
