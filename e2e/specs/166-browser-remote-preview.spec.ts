import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

for (const shell of ["web", "desktop"] as const) {
  test(`${shell} shows a remote browser preview without offering manual control`, async ({ page }) => {
    await rpc("setup.finish", {});
    const { core, token } = await world.info();
    const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
    const tab = {
      tab: "remote-tab",
      url: "https://northwind.example/",
      title: "Northwind",
      profile: "shared",
      control: { kind: "agent", by: "superagent", since: new Date(0).toISOString() },
    };
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lpUAAAAASUVORK5CYII=";
    node.onRequest(async (method, params) => {
      if (method === "browser.tabs") return { tabs: [tab] };
      if (method === "browser.screenshot" && (params as { tab: string }).tab === tab.tab)
        return { mime: "image/jpeg", data: png, bytes: Buffer.byteLength(png, "base64") };
      throw Error("preview unavailable");
    });
    if (shell === "desktop") {
      await page.addInitScript(() => {
        window.apxDesktop = {
          platform: "darwin",
          hasBrowserView: async () => false,
          setBrowserBounds: () => {
            throw Error("a remote tab must not place a native view");
          },
        } as NonNullable<typeof window.apxDesktop>;
      });
    }
    try {
      const { id } = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent" });
      await open(page, `#thread=${id}&panel=browser`);
      const panel = page.locator(".browser");
      const image = panel.getByRole("img", { name: /Live view of the tab|Vista en vivo de la pestaña/ });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
      await expect(panel.locator(".browser__preview-note")).toBeVisible();
      await expect(panel.getByRole("button", { name: /Take control|Tomar control/ })).toHaveCount(0);
      await expect(panel.locator(".browser__page--native")).toHaveCount(0);
      await page.route("**/rpc/browser.screenshot", (route) =>
        route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Preview unavailable" } } }),
      );
      await expect(panel.getByText(/^(No image|Sin imagen)$/)).toBeVisible();
      await expect(image).toHaveCount(0);
      await page.unroute("**/rpc/browser.screenshot");
      await expect(image).toBeVisible();
    } finally {
      node.close();
    }
  });
}
