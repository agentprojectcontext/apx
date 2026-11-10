import type { Page } from "@playwright/test";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

// Edit mode lists the page's parts while nothing is picked: pointing at a row lights the part up in the picture, a
// click picks it as a click on the page does, and a changed part keeps a dot. A real page stands for the agent's.
const LANDING = `<!doctype html><html><head><style>
body{margin:0;font-family:Georgia,serif}main{padding:40px 48px}
h1{font-size:44px;margin:0 0 14px;max-width:560px}p{font:17px system-ui;color:#555;max-width:460px}
.cta{display:inline-block;margin-top:18px;background:#e2552f;color:#fff;padding:12px 22px;border-radius:999px;font:600 15px system-ui;text-decoration:none}
</style></head><body><main>
<h1 id="hero">Shipping without surprises for growing teams</h1>
<p>Track every parcel, tell your customers and get paid on time.</p>
<a class="cta" href="#">Book a demo</a>
</main></body></html>`;

type Edit = { node: number; text?: string };

/** The landing's parts as the browser node describes them: node ids are places in the document. */
async function elements(landing: Page) {
  return landing.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>("*")];
    return [...document.querySelectorAll<HTMLElement>("h1, p, a")].map((el) => {
      const r = el.getBoundingClientRect();
      const tag = el.localName;
      const text = (el.dataset.original ?? el.textContent ?? "").trim();
      return {
        node: all.indexOf(el) + 1,
        tag,
        role: tag === "a" ? "link" : tag === "h1" ? "heading" : "",
        name: text,
        selector: el.id ? `${tag}#${el.id}` : el.className ? `${tag}.${el.className}` : tag,
        kind: tag === "a" ? "link" : tag === "h1" ? "heading" : "text",
        text,
        sensitive: false,
        box: { x: r.x / innerWidth, y: r.y / innerHeight, width: r.width / innerWidth, height: r.height / innerHeight },
        style: { font_size: Number.parseFloat(getComputedStyle(el).fontSize) },
      };
    });
  });
}

async function show(landing: Page, edits: Edit[]) {
  await landing.evaluate((edits) => {
    const all = [...document.querySelectorAll<HTMLElement>("*")];
    for (const el of all) {
      if (el.dataset.original !== undefined) el.textContent = el.dataset.original;
      delete el.dataset.original;
    }
    for (const e of edits) {
      const el = all[e.node - 1];
      if (!el || e.text === undefined) continue;
      el.dataset.original = el.textContent ?? "";
      el.textContent = e.text;
    }
  }, edits);
}

for (const width of [1280, 390]) {
  test(`edit mode lists the page's parts to pick from at ${width}px`, async ({ page }, info) => {
    await rpc("setup.finish", {});
    const landing = await page.context().newPage();
    await landing.setViewportSize({ width: 1280, height: 720 });
    await landing.setContent(LANDING);
    const { core, token } = await world.info();
    const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
    const shown: Edit[][] = [];
    node.onRequest(async (method, params) => {
      const p = params as { edits: Edit[] };
      if (method === "browser.tabs")
        return {
          tabs: [
            {
              tab: "landing-tab",
              url: "http://localhost:5173/",
              title: "Northwind",
              profile: "shared",
              control: { kind: "idle" },
            },
          ],
        };
      if (method === "browser.hold") return { ok: true };
      if (method === "browser.screenshot") {
        const data = (await landing.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
        return { mime: "image/jpeg", data, bytes: data.length };
      }
      if (method === "browser.edit_elements") return { elements: await elements(landing) };
      if (method === "browser.preview_edits") {
        shown.push(p.edits);
        await show(landing, p.edits);
        return { shown: p.edits.length };
      }
      throw new Error(`Unexpected ${method}`);
    });
    try {
      await page.setViewportSize({ width, height: 860 });
      await open(page, "#panel=browser");
      await page.getByRole("button", { name: "Editar", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "Editar" });
      const list = panel.getByRole("region", { name: "Elementos" });
      await expect(list.getByText("Tocá uno en la página o elegilo acá.")).toBeVisible();
      await expect(list.getByRole("button")).toHaveCount(3);
      await expect(list.getByRole("button", { name: /Shipping without surprises.*Título/ })).toBeVisible();
      await expect(list.getByRole("button", { name: /Book a demo.*Enlace/ })).toBeVisible();
      await expect(page.locator(".bedit__shot img")).toBeVisible();

      // Pointing at a row lights its part up in the picture; leaving it puts the light out.
      const cta = list.getByRole("button", { name: /Book a demo/ });
      await cta.hover();
      await expect(page.locator(".bedit__box.is-hover")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`elements-${width}.png`) });
      await page.mouse.move(0, 0);
      await expect(page.locator(".bedit__box.is-hover")).toHaveCount(0);

      // A click picks it as on the page: its fields open.
      await cta.click();
      await expect(panel.getByRole("heading", { name: "Book a demo" })).toBeVisible();
      await panel.getByRole("textbox", { name: "Texto", exact: true }).fill("Get your demo");
      await until(async () => shown.at(-1)?.some((e) => e.text === "Get your demo"));

      // Back to the list: the changed part shows its new words and a dot; one only looked at is not kept.
      await panel.getByRole("button", { name: "Volver a los elementos" }).click();
      const changed = list.getByRole("button", { name: /Get your demo/ });
      await expect(changed).toBeVisible();
      await expect(changed.getByRole("img", { name: "Cambiado" })).toBeVisible();
      await expect(list.getByRole("img", { name: "Cambiado" })).toHaveCount(1);
      await expect(panel.getByRole("region", { name: "Tus cambios" }).locator(".bedit__row")).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`elements-changed-${width}.png`) });
    } finally {
      node.close();
      await node.closed;
      await landing.close();
    }
  });
}
