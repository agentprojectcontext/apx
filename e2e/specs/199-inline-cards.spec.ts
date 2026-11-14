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
    for (const said of ["movies", "flights", "golf", "buy"]) {
      await env.client.call("threads.send", { thread: chat.id, text: said });
      await env.settle(chat.id);
    }
    const views = page.locator(".apx-inline");
    await expect(views).toHaveCount(3);
    const movies = views.nth(0);
    await expect(movies.getByText("Datos de ejemplo")).toBeVisible();
    await expect(movies.locator("img")).toHaveCount(2);
    await expect(movies.getByText("Una expedición imaginaria a la Luna.")).toBeHidden();
    await movies.getByText("Ver detalles").first().click();
    await expect(movies.getByText("Una expedición imaginaria a la Luna.")).toBeVisible();
    await expect(views.nth(2).getByText("Diez minutos de swings suaves.")).toBeVisible();
    await expect(page.getByText("No puedo comprar desde acá: te dejo el enlace en texto.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Comprar" })).toHaveCount(0);
    for (const [i, name] of ["movies", "flights", "golf"].entries())
      await views.nth(i).screenshot({ path: info.outputPath(`${name}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(movies.getByText("La luna tranquila")).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    for (const [i, name] of ["movies", "flights", "golf"].entries())
      await views.nth(i).screenshot({ path: info.outputPath(`${name}-phone.png`) });
  } finally {
    await page.goto("about:blank");
    await env.core.close();
  }
});
