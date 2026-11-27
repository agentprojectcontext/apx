// A tab of the server's own browser, seen from a panel that is not where it runs (the web panel, or a desktop app
// connected by address): it streams live, «Take control» hands it to the owner, and their clicks and keys reach it.
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

for (const shell of ["web", "desktop"] as const) {
  test(`${shell} watches a server tab live and drives it by hand once the owner takes it`, async ({ page }) => {
    await rpc("setup.finish", {});
    // A real JPEG, 400×300: a point on it is a known point on the page.
    await page.goto("about:blank");
    const jpeg = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 300;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = "white";
      g.fillRect(0, 0, 400, 300);
      return c.toDataURL("image/jpeg").split(",")[1] as string;
    });
    const { core, token } = await world.info();
    const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
    const tab = {
      tab: "server-tab",
      url: "https://northwind.example/sign-in",
      title: "Northwind",
      profile: "shared",
      live: true,
      control: { kind: "agent", by: "superagent", since: new Date(0).toISOString() } as Record<string, string>,
    };
    const typed: Array<Record<string, unknown>> = [];
    let seq = 0;
    node.onRequest(async (method, params) => {
      const p = params as Record<string, unknown>;
      if (method === "browser.tabs") return { tabs: [tab] };
      if (method === "browser.frame") {
        if ((p.after as number) >= 1) await new Promise((r) => setTimeout(r, 300));
        return { seq: ++seq, mime: "image/jpeg", data: jpeg, width: 400, height: 300 };
      }
      if (method === "browser.control") {
        tab.control = p.mode === "user" ? { kind: "user", since: new Date().toISOString() } : { kind: "idle" };
        return tab;
      }
      if (method === "browser.input") {
        if (tab.control.kind !== "user") throw Error("take control of the tab first");
        typed.push(...(p.events as Array<Record<string, unknown>>));
        return { ok: true };
      }
      throw Error(`not served: ${method}`);
    });
    if (shell === "desktop") {
      await page.addInitScript(() => {
        window.apxDesktop = {
          platform: "darwin",
          hasBrowserView: async () => false,
          setBrowserBounds: () => {
            throw Error("a server tab must not place a native view");
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
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(400);
      // Live, not the polled preview: it says nothing about being view-only.
      await expect(panel.locator(".browser__preview-note")).toHaveCount(0);
      await expect(panel.locator(".browser__page--native")).toHaveCount(0);

      // Watching takes no hand: until the owner takes the tab, a click reaches nothing.
      await image.click();
      expect(typed).toEqual([]);
      await panel.getByRole("button", { name: /^(Take control|Tomar control)$/ }).click();
      await expect(panel.getByRole("button", { name: /^(Give back|Devolver)$/ })).toBeVisible();

      const box = await image.boundingBox();
      if (!box) throw Error("the live picture has no box");
      // The picture keeps its 4:3 shape from the top of the area, centred across.
      const scale = Math.min(box.width / 400, box.height / 300);
      const left = box.x + (box.width - 400 * scale) / 2;
      await page.mouse.click(left + 100 * scale, box.y + 150 * scale);
      await page.keyboard.type("ada");
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          typed.map((e) => (e.type === "text" ? e.text : e.type === "key" ? `[${e.action}:${e.key}]` : e.action)),
        )
        .toEqual(expect.arrayContaining(["down", "up", "[down:Enter]", "[up:Enter]"]));
      const click = typed.find((e) => e.type === "mouse" && e.action === "down");
      expect(click?.x).toBeCloseTo(0.25, 1);
      expect(click?.y).toBeCloseTo(0.5, 1);
      expect(
        typed
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("ada");

      await panel.getByRole("button", { name: /^(Give back|Devolver)$/ }).click();
      await expect(panel.getByRole("button", { name: /^(Take control|Tomar control)$/ })).toBeVisible();
    } finally {
      node.close();
    }
  });
}
