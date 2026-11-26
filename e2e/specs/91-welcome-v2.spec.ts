// The welcome slides: each said once per device, newest first, each a clip from the docs site; where one cannot
// load, each slide's still stays in its place. Outside hosts are stood in for: the sandbox never reaches them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { esWelcome } from "../../apps/web/src/i18n/welcome-es.ts";
import { ALL_SLIDES, seenBefore, slidesToShow } from "../../apps/web/src/shell/welcomeFilm.ts";
import { buildVersion } from "../../scripts/version.ts";
import { expect, open, test } from "./kit.ts";

const webDir = new URL("../../apps/web/", import.meta.url);
const desktop = JSON.parse(readFileSync(new URL("../../apps/desktop/package.json", import.meta.url), "utf8")) as {
  version: string;
};
const version = process.env.APX_VERSION || buildVersion(desktop.version, fileURLToPath(webDir));
const slides = slidesToShow(version, []);

test.use({ welcome: true });

test("the owner steps through the slides and Skip closes them for good", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Agentes sin paredes" })).toBeVisible();
  await expect(dialog.getByText(`1 de ${slides.length}`, { exact: true })).toBeVisible();
  // The film could not load: the slide's still takes its place.
  await expect(dialog.getByRole("img", { name: "Agentes sin paredes" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Atrás" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Un pedido, muchos agentes" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "Claude Code, con su propia cara" })).toBeVisible();
  await expect(dialog.getByText(`3 de ${slides.length}`, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Atrás" }).click();
  await expect(dialog.getByRole("heading", { name: "Un pedido, muchos agentes" })).toBeVisible();

  await dialog.getByRole("button", { name: "Saltear" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("the last slide ends with Vamos", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  for (let i = 1; i < slides.length; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
  const last = slides.at(-1);
  if (!last) throw new Error(`No welcome slides for ${version}`);
  await expect(dialog.getByRole("heading", { name: esWelcome[`welcome.${last.key}.title`] })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Siguiente" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
});

const keep = (page: import("@playwright/test").Page, corner: object) =>
  page.addInitScript((corner) => {
    try {
      localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, ...corner }));
    } catch {}
  }, corner);

test("after an update only the slide not seen yet shows, and once", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  // The oldest slide this version still shows: older ones expire as releases go by.
  const unseen = slides.at(-1);
  if (!unseen) throw new Error(`No welcome slides for ${version}`);
  await keep(page, { welcomeSeen: ALL_SLIDES.filter((k) => k !== unseen.key) });
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog.getByRole("heading", { name: esWelcome[`welcome.${unseen.key}.title`] })).toBeVisible();
  await expect(dialog.getByText("1 de 1")).toBeVisible();
  await dialog.getByRole("button", { name: "Vamos" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("a device that closed the 2.14.3 welcome sees only what came after it", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await keep(page, { welcome: "whats-new-2.14.3" });
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog.getByRole("heading", { name: "Agentes sin paredes" })).toBeVisible();
  await expect(
    dialog.getByText(`1 de ${slidesToShow(version, seenBefore("whats-new-2.14.3")).length}`, { exact: true }),
  ).toBeVisible();
});

// What a device kept after closing an earlier welcome: the v2 one, then the single-film one.
for (const kept of [true, "whats-new-2.14"]) {
  test(`someone who closed an earlier welcome (${kept}) sees the new slides once`, async ({ page }) => {
    await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
    await keep(page, { welcome: kept });
    await open(page);
    await expect(
      page.getByRole("dialog", { name: "Lo nuevo de APX" }).getByText(`1 de ${slides.length}`, { exact: true }),
    ).toBeVisible();
  });
}
