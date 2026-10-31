import type { Page } from "@playwright/test";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

// The agent's page, drawn by a real browser page the fake browser node stands for: its pictures are the tab's
// screenshots, its elements answer edit mode's points, and the edits shown change it.
const LANDING = `<!doctype html><html><head><style>
body{margin:0;font-family:Georgia,serif}main{padding:40px 48px}
h1{font-size:44px;margin:0 0 14px;max-width:560px}p{font:17px system-ui;color:#555;max-width:460px}
.cta{display:inline-block;margin-top:18px;background:#e2552f;color:#fff;padding:12px 22px;border-radius:999px;font:600 15px system-ui;text-decoration:none}
</style></head><body><main>
<h1 id="hero">Shipping without surprises for growing teams</h1>
<p>Track every parcel, tell your customers and get paid on time.</p>
<a class="cta big" href="#">Book a demo</a>
<form style="margin-top:30px"><input type="password" autocomplete="current-password" value="secret123"></form>
</main></body></html>`;

type Edit = { node: number; text?: string; style?: Record<string, string | number> };

async function inspect(landing: Page, x: number, y: number) {
  return landing.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x * innerWidth, y * innerHeight) as HTMLElement | null;
      if (!el || el === document.body || el.tagName === "MAIN") return null;
      const all = [...document.querySelectorAll("*")];
      const r = el.getBoundingClientRect();
      const tag = el.localName;
      const sensitive = (el as HTMLInputElement).type === "password";
      const text = sensitive || el.children.length ? null : (el.dataset.original ?? el.textContent ?? "").trim();
      const cs = getComputedStyle(el);
      return {
        node: all.indexOf(el) + 1,
        tag,
        role: tag === "a" ? "link" : tag === "h1" ? "heading" : "",
        name: sensitive ? "" : (text ?? ""),
        selector: el.id ? `${tag}#${el.id}` : el.className ? `${tag}.${el.className.split(" ").join(".")}` : tag,
        text,
        sensitive,
        box: { x: r.x / innerWidth, y: r.y / innerHeight, width: r.width / innerWidth, height: r.height / innerHeight },
        style: {
          color: cs.color,
          background: cs.backgroundColor,
          font_size: Number.parseFloat(cs.fontSize),
          padding: 0,
        },
      };
    },
    { x, y },
  );
}

async function show(landing: Page, edits: Edit[]) {
  await landing.evaluate((edits) => {
    const all = [...document.querySelectorAll<HTMLElement>("*")];
    for (const el of all) {
      if (el.dataset.original !== undefined) el.textContent = el.dataset.original;
      if (el.dataset.style !== undefined) el.setAttribute("style", el.dataset.style);
      delete el.dataset.original;
      delete el.dataset.style;
    }
    for (const e of edits) {
      const el = all[e.node - 1];
      if (!el) continue;
      el.dataset.style = el.getAttribute("style") ?? "";
      if (e.style?.color) el.style.color = String(e.style.color);
      if (e.style?.font_size) el.style.fontSize = `${e.style.font_size}px`;
      if (e.text !== undefined) {
        el.dataset.original = el.textContent ?? "";
        el.textContent = e.text;
      }
    }
  }, edits);
}

/** Where a landing element lies in the panel's picture of the page. */
async function inPicture(page: Page, landing: Page, selector: string) {
  const shot = await page.locator(".bedit__shot").boundingBox();
  const el = await landing.locator(selector).boundingBox();
  const size = landing.viewportSize();
  if (!shot || !el || !size) throw new Error("no box");
  return {
    x: shot.x + ((el.x + el.width / 2) / size.width) * shot.width,
    y: shot.y + ((el.y + el.height / 2) / size.height) * shot.height,
  };
}

for (const width of [1280, 390]) {
  test(`browser edit mode at ${width}px: pick, see the change live and ask the agent for it`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    const landing = await page.context().newPage();
    await landing.setViewportSize({ width: 1280, height: 720 });
    await landing.setContent(LANDING);
    const { core, token } = await world.info();
    const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
    const shown: Edit[][] = [];
    node.onRequest(async (method, params) => {
      const p = params as { x: number; y: number; edits: Edit[] };
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
      if (method === "browser.inspect") return { element: await inspect(landing, p.x, p.y) };
      if (method === "browser.preview_edits") {
        shown.push(p.edits);
        await show(landing, p.edits);
        return { shown: p.edits.length };
      }
      throw new Error(`Unexpected ${method}`);
    });
    try {
      const vera = await rpc<{ id: string }>("agents.create", { slug: `web-maker-${width}`, name: "Vera" });
      const thread = (
        await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: vera.id, title: "Northwind landing" })
      ).id;
      await page.setViewportSize({ width, height: 860 });
      await open(page, `#thread=${thread}&panel=browser`);
      await page.getByRole("button", { name: "Editar", exact: true }).click();
      await expect(page.getByText("Tocá la parte que querés cambiar")).toBeVisible();
      await expect(page.getByText("Elegí qué cambiar")).toBeVisible();
      await expect(page.locator(".bedit__shot img")).toBeVisible();

      // The pointer lights an element up; a click picks it and opens its fields.
      const button = await inPicture(page, landing, ".cta");
      await page.mouse.move(button.x, button.y);
      await expect(page.locator(".bedit__box.is-hover")).toBeVisible();
      await page.mouse.click(button.x, button.y);
      const panel = page.getByRole("complementary", { name: "Editar" });
      await expect(panel.getByRole("heading", { name: "Book a demo" })).toBeVisible();
      await expect(panel.getByText("a.cta.big")).toBeVisible();
      await panel.getByRole("textbox", { name: "Texto", exact: true }).fill("Get your demo");
      await panel.getByLabel("Tamaño de letra").fill("19");
      // The change shows in the page a moment later, only through the node.
      await until(async () => shown.at(-1)?.some((e) => e.text === "Get your demo" && e.style?.font_size === 19));
      await expect(landing.locator(".cta")).toHaveText("Get your demo");
      await page.screenshot({ path: info.outputPath(`edit-button-${width}.png`) });

      // A password field is named but never read or changed.
      const field = await inPicture(page, landing, "input");
      await page.mouse.click(field.x, field.y);
      await expect(panel.getByText("no se puede cambiar acá")).toBeVisible();
      await expect(panel.getByRole("textbox", { name: "Texto", exact: true })).toHaveCount(0);
      await panel.getByRole("button", { name: "Quitar" }).last().click();

      const title = await inPicture(page, landing, "h1");
      await page.mouse.click(title.x, title.y);
      await expect(panel.getByRole("heading", { name: /Shipping without surprises/ })).toBeVisible();
      await panel.getByPlaceholder("Decilo con tus palabras").fill("Más corto, en dos líneas");
      await expect(panel.getByRole("button", { name: "Pedirle a Vera (2)" })).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`edit-list-${width}.png`) });

      await panel.getByRole("button", { name: "Pedirle a Vera (2)" }).click();
      const composer = page.getByRole("textbox", { name: /Escribile/ });
      await expect(composer).toHaveValue(/^> Cambios en la página localhost:5173 \(http:\/\/localhost:5173\/\):/);
      await expect(composer).toHaveValue(
        /> 1\. «Book a demo» \(`a\.cta\.big`\): texto → «Get your demo»; tamaño de letra → 19 px/,
      );
      await expect(composer).toHaveValue(
        /> 2\. «Shipping without surprises for growing teams» \(`h1#hero`\): Más corto, en dos líneas/,
      );
      // Leaving edit mode puts the page back as its own code draws it.
      await until(async () => shown.at(-1)?.length === 0);
      await expect(landing.locator(".cta")).toHaveText("Book a demo");
      await expect(page.locator(".bedit")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`edit-asked-${width}.png`) });
    } finally {
      node.close();
      await node.closed;
      await landing.close();
    }
  });
}
