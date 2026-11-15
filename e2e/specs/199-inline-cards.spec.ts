import fs from "node:fs";
import path from "node:path";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const A2UI_BASIC = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
const fence = (lang: string, value: unknown) => [`\`\`\`${lang}`, JSON.stringify(value), "```"].join("\n");

test("an agent's results and A2UI cards draw as APX cards, open their details and fall back", async ({
  page,
}, info) => {
  let media: Record<string, string> = {};
  const answers: Record<string, () => string> = {
    movies: () =>
      `Dos ideas.\n\n${fence("apx-cards", {
        title: "Ideas de películas",
        example: true,
        fallback: "Dos ideas: La luna tranquila y La costa silenciosa.",
        items: [
          {
            id: "moon",
            eyebrow: "Película · 2024",
            title: "La luna tranquila",
            description: "Drama espacial ficticio.",
            image: media.movie,
            badges: ["Drama", "108 min"],
            fields: [
              { label: "Dirección", value: "A. Rivera" },
              { label: "Dónde", value: "Sin confirmar" },
            ],
            details: "Una expedición imaginaria a la Luna.",
            images: [media.hotel, media.flight],
            action: { label: "Ver la ficha", url: "https://example.com/luna" },
          },
          {
            id: "coast",
            eyebrow: "Serie · 2023",
            title: "La costa silenciosa",
            description: "Aventura junto al mar.",
            image: media.hotel,
            badges: ["Aventura", "8 episodios"],
            details: "Un viaje imaginario por la costa.",
          },
        ],
      })}`,
    flights: () =>
      fence("apx-cards", {
        title: "Ideas de vuelos",
        layout: "list",
        fallback: "Un vuelo a Mendoza.",
        items: [
          {
            id: "mdz",
            eyebrow: "Ida · 2 h 05 min",
            title: "Buenos Aires → Mendoza",
            description: "Directo, sale a la mañana.",
            image: media.flight,
            fields: [
              { label: "Sale", value: "08:10" },
              { label: "Llega", value: "10:15" },
            ],
          },
        ],
      }),
    golf: () =>
      fence("a2ui", {
        fallback: "Rutina de golf: calentar y practicar el putt.",
        messages: [
          { version: "1.0", createSurface: { surfaceId: "golf", catalogId: A2UI_BASIC } },
          {
            version: "1.0",
            updateComponents: {
              surfaceId: "golf",
              components: [
                { id: "root", component: "List", direction: "horizontal", children: ["c1", "c2"] },
                { id: "c1", component: "Card", child: "k1" },
                { id: "k1", component: "Column", children: ["t1", "b1", "m1"] },
                { id: "t1", component: "Text", text: "Calentar", weight: "bold" },
                { id: "b1", component: "Text", text: "Diez minutos de swings suaves." },
                { id: "m1", component: "Modal", trigger: "mt", content: "mc" },
                { id: "mt", component: "Text", text: "Cómo" },
                { id: "mc", component: "Text", text: "Hombros sueltos, sin forzar." },
                { id: "c2", component: "Card", child: "k2" },
                { id: "k2", component: "Column", children: ["t2", "b2"] },
                { id: "t2", component: "Text", text: "Putt", weight: "bold" },
                { id: "b2", component: "Text", text: "Veinte golpes a un metro." },
              ],
            },
          },
        ],
      }),
    pick: () =>
      fence("apx-cards", {
        view: "choice",
        title: "Auriculares",
        note: "Precios de hoy",
        quantity: 3,
        fallback: "Bruma Lite $64.900 o Pulso Pro $98.500.",
        options: [
          { id: "bruma", title: "Bruma Lite", price: "$64.900", rating: "4,2" },
          {
            id: "pulso",
            title: "Pulso Pro",
            price: "$98.500",
            was: "$118.000",
            badge: { label: "Recomendado", tone: "info" },
          },
        ],
        submit: { label: "Seguir con esta" },
      }),
    book: () =>
      fence("apx-cards", {
        view: "booking",
        fallback: "Hostería del Bosque: hoy 21:00.",
        place: { title: "Hostería del Bosque", rating: "4,6" },
        days: [
          { label: "Hoy", sub: "vie 14" },
          { label: "Lun", sub: "cerrado", off: true },
        ],
        times: ["20:00", { label: "20:30", off: true }, "21:00"],
        people: { min: 1, max: 6, value: 2 },
        submit: { label: "Reservar" },
      }),
    places: () =>
      fence("apx-cards", {
        view: "places",
        title: "Cafés cerca",
        fallback: "Café del Puerto y Panadería Norte.",
        places: [
          { id: "c1", title: "Café del Puerto", lat: -34.6037, lng: -58.3816 },
          { id: "c2", title: "Panadería Norte", lat: -34.5967, lng: -58.3813 },
        ],
      }),
    buy: () =>
      fence("a2ui", {
        fallback: "No puedo comprar desde acá: te dejo el enlace en texto.",
        messages: [
          { version: "1.0", createSurface: { surfaceId: "b", catalogId: A2UI_BASIC } },
          {
            version: "1.0",
            updateComponents: {
              surfaceId: "b",
              components: [
                { id: "root", component: "Button", child: "x", action: { event: { name: "buy" } } },
                { id: "x", component: "Text", text: "Comprar" },
              ],
            },
          },
        ],
      }),
  };
  const env = await startCore({ port: 0, llm: scriptedLlm((_req, ctx) => say(answers[ctx.said]?.() ?? "ok")) });
  try {
    await env.client.call("setup.finish", {});
    const dir = path.resolve(import.meta.dirname, "../fixtures/media");
    const upload = async (name: string) =>
      (
        await env.client.call("media.upload", {
          name: `scene-${name}.webp`,
          mime: "image/webp",
          data: fs.readFileSync(path.join(dir, `scene-${name}.webp`)).toString("base64"),
        })
      ).media.id;
    media = { movie: await upload("movie"), hotel: await upload("hotel"), flight: await upload("flight") };
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    for (const said of ["movies", "flights", "golf", "buy", "pick", "book", "places"]) {
      await env.client.call("threads.send", { thread: chat.id, text: said });
      await env.settle(chat.id);
    }
    const views = page.locator(".apx-inline");
    await expect(views).toHaveCount(6);
    const movies = views.nth(0);
    await expect(movies.getByText("Datos de ejemplo")).toBeVisible();
    await expect(movies.locator(".apx-inline__track img")).toHaveCount(2);
    await expect(movies.getByRole("link", { name: "Ver la ficha" })).toHaveAttribute(
      "href",
      "https://example.com/luna",
    );
    await expect(movies.getByText("1 / 2")).toBeVisible();
    await movies.getByText("+2").click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByText("1 / 3")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(page.getByText("Una expedición imaginaria a la Luna.")).toBeHidden();
    await movies.getByRole("button", { name: "Ver detalles" }).first().click();
    const details = page.getByRole("dialog");
    await expect(details.getByText("Una expedición imaginaria a la Luna.")).toBeVisible();
    await expect(details.getByText("A. Rivera")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(views.nth(2).getByText("Diez minutos de swings suaves.")).toBeVisible();
    await expect(page.getByText("No puedo comprar desde acá: te dejo el enlace en texto.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Comprar" })).toHaveCount(0);
    // Choosing writes to the chat as the owner, only once something is chosen.
    const pick = views.nth(3);
    const go = pick.getByRole("button", { name: "Seguir con esta" });
    await expect(go).toBeDisabled();
    await pick.getByText("Pulso Pro").click();
    await pick.getByRole("button", { name: "Más" }).click();
    await go.click();
    await expect(page.getByText("Quiero 2 × Pulso Pro ($98.500). Confirmame antes de pagar.")).toBeVisible();
    await expect(pick.getByRole("button", { name: "Enviado" })).toBeDisabled();
    const book = views.nth(4);
    await expect(book.getByRole("button", { name: /Lun/ })).toBeDisabled();
    await book.getByRole("button", { name: /Hoy/ }).click();
    await book.getByRole("button", { name: "21:00" }).click();
    await book.getByRole("button", { name: "Reservar" }).click();
    await expect(
      page.getByText("Reservá en Hostería del Bosque: Hoy vie 14 a las 21:00, 2 personas. Confirmame antes de pagar."),
    ).toBeVisible();
    // Places sit on a street map, its tiles in the panel's own scheme.
    const map = views.nth(5).locator(".apx-map");
    await expect(map.getByRole("button", { name: "Panadería Norte" })).toBeVisible();
    await expect(map.locator("img.apx-map__tile").first()).toHaveAttribute("src", /\/World_(Light|Dark)_Gray_Base\//);
    // Reloaded, the cards wait as a placeholder while their code loads, never as the block the agent wrote.
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route(/\/InlineView-[^/]*\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByRole("status", { name: "Armando las tarjetas…" }).first()).toBeVisible();
    await expect(page.getByText('"title":"Ideas de películas"')).toHaveCount(0);
    release();
    await expect(views).toHaveCount(6);
    await page.unrouteAll();
    for (const [i, name] of ["movies", "flights", "golf", "pick", "book", "places"].entries())
      await views.nth(i).screenshot({ path: info.outputPath(`${name}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(movies.getByText("La luna tranquila")).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    for (const [i, name] of ["movies", "flights", "golf", "pick", "book", "places"].entries())
      await views.nth(i).screenshot({ path: info.outputPath(`${name}-phone.png`) });
  } finally {
    await page.goto("about:blank");
    await env.core.close();
  }
});
