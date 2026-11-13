// The welcome slides: each said once per device, newest first, each a clip from the docs site; where one cannot
// load, each slide's still stays in its place. Outside hosts are stood in for: the sandbox never reaches them.
import { ALL_SLIDES } from "../../apps/web/src/shell/welcomeFilm.ts";
import { expect, open, test } from "./kit.ts";

test.use({ welcome: true });

test("the owner steps through the slides and Skip closes them for good", async ({ page }) => {
  await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Chats en grupo" })).toBeVisible();
  await expect(dialog.getByText("1 de 13")).toBeVisible();
  // The film could not load: the slide's still takes its place.
  await expect(dialog.getByRole("img", { name: "Chats en grupo" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Atrás" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Responde quien corresponde" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "Cada uno con su modelo" })).toBeVisible();
  await expect(dialog.getByText("3 de 13")).toBeVisible();
  await dialog.getByRole("button", { name: "Atrás" }).click();
  await expect(dialog.getByRole("heading", { name: "Responde quien corresponde" })).toBeVisible();

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
  for (let i = 1; i < 13; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Una revisión semanal" })).toBeVisible();
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
  await keep(page, { welcomeSeen: ALL_SLIDES.filter((k) => k !== "groups") });
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Lo nuevo de APX" });
  await expect(dialog.getByRole("heading", { name: "Chats en grupo" })).toBeVisible();
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
  await expect(dialog.getByRole("heading", { name: "Chats en grupo" })).toBeVisible();
  await expect(dialog.getByText("1 de 3")).toBeVisible();
});

// What a device kept after closing an earlier welcome: the v2 one, then the single-film one.
for (const kept of [true, "whats-new-2.14"]) {
  test(`someone who closed an earlier welcome (${kept}) sees the new slides once`, async ({ page }) => {
    await page.route("https://apxagent.app/**", (route) => route.abort("aborted"));
    await keep(page, { welcome: kept });
    await open(page);
    await expect(page.getByRole("dialog", { name: "Lo nuevo de APX" }).getByText("1 de 13")).toBeVisible();
  });
}
