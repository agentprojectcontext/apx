import type { Page, Route } from "@playwright/test";
import type { Message } from "../../packages/protocol/src/domain.ts";
import { LONG_PAGE as LONG } from "../fake-llm.ts";
import { expect, open, rpc, test, until } from "./kit.ts";

// A web page an agent made is a page, not a widget: in the chat it reads like an HTML block (its code, Copy, Expand,
// Edit), it opens on a screen of its own at a computer's or a phone's width, and a long one is edited whole, scrolling
// beside a panel that stays put. Widgets keep their editor with fewer buttons, and the share menu stays on screen.

/** A chat where an agent made a long web page and a widget. */
async function chatWithPage(tag: string) {
  const thread = (await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" })).id;
  const made = async (text: string, count: number) => {
    await rpc("threads.send", { thread, text });
    await until(async () => {
      const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread });
      return messages.flatMap((m) => m.parts).filter((p) => p.type === "surface").length >= count;
    });
  };
  await made(`make a long web page coffee-${tag}`, 1);
  await made("show a widget please", 2);
  return { thread };
}

/**
 * The core's edit page, played by a real browser page holding the long page at the width asked: its whole picture,
 * and what lies under a point of it (fractions of the whole page, as the core answers for a web page).
 */
async function fakeEditPage(page: Page, opened: number[], hold: Promise<void> = Promise.resolve()) {
  const edit = await page.context().newPage();
  const reply = (route: Route, result: unknown) => route.fulfill({ json: { ok: true, result } });
  const body = (route: Route) => JSON.parse(route.request().postData() ?? "{}");
  await page.route("**/rpc/surfaces.edit_open", async (route) => {
    const { width } = body(route);
    opened.push(width);
    // The test lets the edit page answer once it has seen what shows meanwhile.
    await hold;
    await edit.setViewportSize({ width, height: 800 });
    await edit.setContent(LONG);
    await reply(route, { page: "p1" });
  });
  await page.route("**/rpc/surfaces.edit_shot", async (route) => {
    const data = (await edit.screenshot({ type: "jpeg", fullPage: true })).toString("base64");
    await reply(route, { mime: "image/jpeg", data, bytes: data.length });
  });
  await page.route("**/rpc/surfaces.edit_inspect", async (route) => {
    const { x, y } = body(route);
    const element = await edit.evaluate(
      ({ x, y }) => {
        const w = document.documentElement.scrollWidth;
        const h = document.documentElement.scrollHeight;
        scrollTo(0, y * h - innerHeight / 2);
        const el = document.elementFromPoint(x * w, y * h - scrollY) as HTMLElement | null;
        if (!el || el === document.body || el.localName === "html") return null;
        const r = el.getBoundingClientRect();
        const text = el.children.length ? null : (el.textContent ?? "").trim();
        return {
          node: [...document.querySelectorAll("*")].indexOf(el) + 1,
          tag: el.localName,
          role: "",
          name: text ?? "",
          selector: el.id ? `${el.localName}#${el.id}` : el.localName,
          text,
          sensitive: false,
          box: { x: r.x / w, y: (r.y + scrollY) / h, width: r.width / w, height: r.height / h },
          style: { color: "rgb(17, 17, 17)", font_size: 16, padding: 0 },
        };
      },
      { x, y },
    );
    await reply(route, { element });
  });
  await page.route("**/rpc/surfaces.edit_preview", (route) => reply(route, { shown: body(route).edits.length }));
  await page.route("**/rpc/surfaces.edit_close", (route) => reply(route, { ok: true }));
  return edit;
}

for (const width of [1280, 390]) {
  test(`a web page at ${width}px: an HTML block in the chat, its own screen, and a long page edited whole beside a fixed panel`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    const { thread } = await chatWithPage(String(width));
    const opened: number[] = [];
    let release = () => {};
    const edit = await fakeEditPage(page, opened, new Promise<void>((r) => (release = r)));
    try {
      await page.setViewportSize({ width, height: 860 });
      await open(page, `#thread=${thread}`);

      // In the chat: like an HTML block, with Edit, and none of a widget's buttons.
      const block = page.locator(".transcript .pagepart");
      await expect(block.locator(".apx-codeframe__lang")).toHaveText("HTML");
      await expect(block.locator(".apx-codeframe__title")).toHaveText("Coffee shop");
      await expect(block.frameLocator("iframe").getByRole("heading", { name: "Coffee at your door" })).toBeVisible();
      for (const gone of ["Pedirle cambios a su agente", "Borrar", "Memoria"])
        await expect(block.getByRole("button", { name: gone })).toHaveCount(0);
      await block.getByRole("radio", { name: "Código" }).click();
      await expect(block.getByText("<h1>Coffee at your door</h1>")).toBeVisible();
      await block.getByRole("radio", { name: "Vista previa" }).click();
      await block.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`page-block-${width}.png`) });
      await block.getByRole("button", { name: "Más" }).click();
      for (const item of ["Compartir", "Abrir en otra ventana", "Descargar (.html)"])
        await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
      await page.keyboard.press("Escape");

      // Its own screen: the page fills it, at a computer's or a phone's width.
      await block.getByRole("button", { name: "Expandir" }).click();
      const screen = page.getByRole("region", { name: "Coffee shop" });
      const frame = screen.locator(".pageframe__iframe");
      await expect(frame).toBeVisible();
      const phone = screen.getByRole("radio", { name: "Teléfono" });
      if (width === 1280) {
        await expect(screen.getByRole("radio", { name: "Escritorio" })).toBeChecked();
        await phone.click();
      }
      await expect(phone).toBeChecked();
      // A phone's width, or all the room there is on a phone.
      const room = Math.round((await screen.locator(".pagescreen__body").boundingBox())?.width ?? 0);
      await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBe(Math.min(390, room));
      await page.screenshot({ path: info.outputPath(`page-screen-${width}.png`) });
      if (width === 1280) await screen.getByRole("radio", { name: "Escritorio" }).click();

      // Edit mode: the whole page at that width, scrolling on its own; the panel stays where it is.
      await screen.getByRole("button", { name: "Editar", exact: true }).click();
      // As wide as the page shows beside the panel (1:1, as outside edit mode), or a phone's width on a phone.
      if (width === 1280) await expect.poll(() => opened.at(-1) ?? 0).toBeGreaterThan(800);
      else await expect.poll(() => opened.at(-1)).toBe(390);
      // While edit mode gets ready the page stays on screen as it is, never an empty screen.
      await expect(screen.getByRole("status").filter({ hasText: "Preparando la edición…" })).toBeVisible();
      await expect(frame.contentFrame().getByRole("heading", { name: "Coffee at your door" })).toBeVisible();
      release();
      const canvas = page.locator(".bedit__page");
      const shot = page.locator(".bedit__shot img");
      await expect(shot).toBeVisible();
      await expect.poll(() => canvas.evaluate((e) => e.scrollHeight > e.clientHeight * 2)).toBe(true);
      const panel = page.getByRole("complementary", { name: "Editar" });
      const before = await panel.boundingBox();
      const area = await canvas.boundingBox();
      if (!before || !area) throw new Error("no layout");
      // Beside the page on a wide screen, under it on a phone.
      if (width === 1280) expect(before.x).toBeGreaterThanOrEqual(area.x + area.width - 1);
      else expect(before.y).toBeGreaterThanOrEqual(area.y + area.height - 1);
      await canvas.evaluate((e) => e.scrollTo(0, e.scrollHeight));
      await expect.poll(async () => (await panel.boundingBox())?.y).toBe(before.y);

      // The end of a long page is picked like its top.
      const pic = await page.locator(".bedit__shot").boundingBox();
      if (!pic) throw new Error("no picture");
      // Where the footer's text sits on the whole page, as a fraction of it.
      const at = await edit.evaluate(() => {
        const r = (document.getElementById("end") as HTMLElement).getBoundingClientRect();
        return (r.top + scrollY + r.height / 2) / document.documentElement.scrollHeight;
      });
      const atY = pic.y + at * pic.height;
      await page.mouse.click(pic.x + pic.width * 0.2, atY);
      await expect(panel.getByRole("heading", { name: "Write to us" })).toBeVisible();
      // The part picked is marked where it is, with its number, under an ordinary pointer.
      const mark = page.locator(".bedit__box.is-selected");
      await expect(mark).toBeInViewport();
      await expect(mark.locator(".bedit__num")).toHaveText("1");
      await expect(page.locator(".bedit__shot")).toHaveCSS("cursor", "pointer");
      await expect(screen.getByText("Preparando la edición…")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`page-edit-${width}.png`) });
      await panel.getByRole("button", { name: "Descartar" }).click();
      await expect(page.locator(".bedit")).toHaveCount(0);
    } finally {
      await edit.close();
    }
  });

  test(`a widget at ${width}px keeps few buttons in its chat, says when it has no memory, and its share menu stays on screen`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    const { thread } = await chatWithPage(`w${width}`);
    await page.setViewportSize({ width, height: 860 });
    await open(page, `#thread=${thread}`);
    const card = page.locator(".transcript .surfacecard").filter({ hasText: "Coverage audit" }).last();
    await expect(card.frameLocator("iframe").getByText("Coverage rows")).toBeVisible();
    // In its own chat: no asking its agent (this is its chat) and no deleting it for good.
    await expect(card.getByRole("button", { name: "Pedirle cambios a su agente" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Editar/ })).toBeVisible();
    await card.getByRole("button", { name: "Más" }).click();
    for (const item of [/^Fijar al tablero/, /^Fijar en Apps/, /^Abrir en otra ventana/, /^Memoria/])
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Borrar/ })).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^Memoria/ }).click();
    const memory = page.getByRole("dialog");
    await expect(memory.getByText("Sin memoria")).toBeVisible();
    await expect(memory.getByRole("button", { name: /Borrar/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The share menu fits on the screen and says only what the owner chooses.
    await card.getByRole("button", { name: /^Compartir/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /^Cualquiera con el enlace/ })).toBeVisible();
    await expect(menu.getByText(/no acceden al estado de APX/)).toHaveCount(0);
    const box = await menu.boundingBox();
    if (!box) throw new Error("no menu");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`widget-share-${width}.png`) });
  });
}

for (const width of [1280, 390]) {
  test(`at ${width}px, a widget pinned to Apps stays a widget, and a web page is never on a board`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    const { thread } = await chatWithPage(`apps${width}`);
    await page.setViewportSize({ width, height: 860 });
    await open(page, `#thread=${thread}`);
    const card = page.locator(".transcript .surfacecard").filter({ hasText: "Coverage audit" }).last();
    await card.getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitem", { name: "Fijar en Apps" }).click();
    // Listed in Apps, it keeps its kind: the widget's violet grid, not an app's green.
    const dock = page.locator(".appsdock__icon .apx-tile").first();
    await expect(dock).toHaveClass(/apx-tile--violet/);
    await expect(card.getByText(/^Widget ·/)).toBeVisible();
    // The launcher names it as what it is, kept in Apps: never "App".
    await page.getByRole("button", { name: "Abrir un artefacto" }).first().click();
    const row = page.getByRole("option", { name: /Coverage audit/ }).first();
    await expect(row).toContainText("Widget · En Apps");
    await page.screenshot({ path: info.outputPath(`apps-widget-${width}.png`) });
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitem", { name: "Desfijar de Apps" }).click();

    // A web page offers no board, and the core refuses one.
    const block = page.locator(".transcript .pagepart");
    await block.getByRole("button", { name: "Más" }).click();
    await expect(page.getByRole("menuitem", { name: /tablero/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const { surfaces } = await rpc<{ surfaces: Array<{ id: string; name: string }> }>("surfaces.list", {});
    const made = surfaces.find((s) => s.name === `coffee-apps${width}`);
    if (!made) throw new Error("no page");
    await expect(rpc("surfaces.update", { surface: made.id, pinned: true })).rejects.toThrow(/not a board tile/);
  });
}
