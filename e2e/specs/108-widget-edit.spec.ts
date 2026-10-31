import type { Page, Route } from "@playwright/test";
import { expect, open, rpc, test, until } from "./kit.ts";

// The widget's edit page is the core's own headless browser; here a real browser page stands in for it, answering the
// panel's surfaces.edit_* calls, so what the owner sees and sends is checked on any machine.
const WIDGET = `<div style="padding:16px;font-family:system-ui"><h2 id="title">Weekly sales</h2>
<p class="total">Total: <b>$12,480</b></p><button class="cta">See details</button></div>`;

type Edit = { node: number; text?: string; style?: Record<string, string | number> };

async function inspect(widget: Page, x: number, y: number) {
  return widget.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x * innerWidth, y * innerHeight) as HTMLElement | null;
      if (!el || el === document.body || el.parentElement === document.body) return null;
      const all = [...document.querySelectorAll("*")];
      const r = el.getBoundingClientRect();
      const text = el.children.length ? null : (el.dataset.original ?? el.textContent ?? "").trim();
      const cs = getComputedStyle(el);
      return {
        node: all.indexOf(el) + 1,
        tag: el.localName,
        role: "",
        name: text ?? "",
        selector: el.id ? `${el.localName}#${el.id}` : el.className ? `${el.localName}.${el.className}` : el.localName,
        text,
        sensitive: false,
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

async function show(widget: Page, edits: Edit[]) {
  await widget.evaluate((edits) => {
    const all = [...document.querySelectorAll<HTMLElement>("*")];
    for (const el of all) {
      if (el.dataset.original !== undefined) el.textContent = el.dataset.original;
      el.style.color = "";
      delete el.dataset.original;
    }
    for (const e of edits) {
      const el = all[e.node - 1];
      if (!el) continue;
      if (e.style?.color) el.style.color = String(e.style.color);
      if (e.text !== undefined) {
        el.dataset.original = el.textContent ?? "";
        el.textContent = e.text;
      }
    }
  }, edits);
}

for (const width of [1280, 390]) {
  test(`widget edit mode at ${width}px: pick a part of a widget and ask its agent for the change`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    const widget = await page.context().newPage();
    const opened: Array<{ surface: string; width: number; mode: string }> = [];
    const shown: Edit[][] = [];
    let closed = 0;
    const reply = (route: Route, result: unknown) => route.fulfill({ json: { ok: true, result } });
    const body = (route: Route) => JSON.parse(route.request().postData() ?? "{}");
    await page.route("**/rpc/surfaces.edit_open", async (route) => {
      const p = body(route);
      opened.push(p);
      await widget.setViewportSize({ width: p.width, height: 240 });
      await widget.setContent(WIDGET);
      await reply(route, { page: "w1" });
    });
    await page.route("**/rpc/surfaces.edit_shot", async (route) => {
      const data = (await widget.screenshot({ type: "jpeg" })).toString("base64");
      await reply(route, { mime: "image/jpeg", data, bytes: data.length });
    });
    await page.route("**/rpc/surfaces.edit_inspect", async (route) => {
      const p = body(route);
      await reply(route, { element: await inspect(widget, p.x, p.y) });
    });
    await page.route("**/rpc/surfaces.edit_preview", async (route) => {
      const p = body(route);
      shown.push(p.edits);
      await show(widget, p.edits);
      await reply(route, { shown: p.edits.length });
    });
    await page.route("**/rpc/surfaces.edit_close", async (route) => {
      closed++;
      await reply(route, { ok: true });
    });
    try {
      const vera = await rpc<{ id: string }>("agents.create", { slug: `widget-maker-${width}`, name: "Vera" });
      const thread = (
        await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: vera.id, title: "Weekly sales" })
      ).id;
      const made = await rpc<{ id: string }>("surfaces.show", {
        name: `weekly-sales-${width}`,
        title: "Weekly sales",
        html: WIDGET,
        thread,
      });
      await page.setViewportSize({ width, height: 860 });
      await open(page, `#thread=${thread}&panel=widget`);
      const card = page.getByRole("region", { name: "Weekly sales" });
      await card.getByRole("button", { name: "Elegí partes de la página y pedí cambios" }).click();
      await until(async () => opened.length === 1);
      expect(opened[0]?.surface).toBe(made.id);
      expect(opened[0]?.width).toBeGreaterThan(200);
      await expect(page.getByText("Tocá la parte que querés cambiar")).toBeVisible();
      await expect(page.locator(".bedit__shot img")).toBeVisible();

      const shot = await page.locator(".bedit__shot").boundingBox();
      const title = await widget.locator("h2").boundingBox();
      const size = widget.viewportSize();
      if (!shot || !title || !size) throw new Error("no box");
      const x = shot.x + ((title.x + 20) / size.width) * shot.width;
      const y = shot.y + ((title.y + title.height / 2) / size.height) * shot.height;
      await page.mouse.move(x, y);
      await expect(page.locator(".bedit__box.is-hover")).toBeVisible();
      await page.mouse.click(x, y);
      const panel = page.getByRole("complementary", { name: "Editar" });
      await expect(panel.getByText("h2#title")).toBeVisible();
      await panel.getByRole("textbox", { name: "Texto", exact: true }).fill("Sales this week");
      await until(async () => shown.at(-1)?.some((e) => e.text === "Sales this week"));
      await expect(widget.locator("h2")).toHaveText("Sales this week");
      await panel.getByPlaceholder("Decilo con tus palabras").fill("Que se lea más grande");
      await page.screenshot({ path: info.outputPath(`widget-edit-${width}.png`) });

      await panel.getByRole("button", { name: "Pedirle a Vera" }).click();
      const composer = page.getByRole("textbox", { name: /Escribile/ });
      await expect(composer).toHaveValue(
        new RegExp(`^> Cambios en el widget «Weekly sales» \\(weekly-sales-${width}\\):`),
      );
      await expect(composer).toHaveValue(
        /> 1\. «Weekly sales» \(`h2#title`\): texto → «Sales this week»; Que se lea más grande/,
      );
      // Leaving edit mode closes the widget's page; the widget shows again as it is.
      await until(async () => closed === 1);
      await expect(page.locator(".bedit")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`widget-asked-${width}.png`) });
    } finally {
      await widget.close();
    }
  });
}
