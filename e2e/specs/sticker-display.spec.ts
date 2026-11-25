import fs from "node:fs";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { literalCaption, stickerFixture } from "../sticker-fixture.ts";
import { expect, test } from "./kit.ts";

test("sticker captions and historical grouped previews in both languages and widths", async ({ page }, info) => {
  test.setTimeout(120_000);
  const external = process.env.STICKER_REVIEW_INFO;
  const h = external ? undefined : await stickerFixture();
  const fixture: { url: string; thread: string; raw: string } | undefined = external
    ? JSON.parse(fs.readFileSync(external, "utf8"))
    : h?.info;
  if (!fixture) throw new Error("Missing sticker fixture");
  const client = new ApxClient({ url: fixture.url });
  try {
    await page.addInitScript(() => {
      if (location.protocol !== "http:") return;
      const language = new URL(location.href).searchParams.get("lang") ?? "es";
      localStorage.setItem("apx.prefs", JSON.stringify({ language, inboxByChannel: true }));
    });
    for (const language of ["es", "en"]) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${fixture.url}/?lang=${language}#channel=test&chat=${fixture.thread}`);
        await expect(page.locator(".chan__text")).toHaveText([
          "[sticker]",
          "Human caption",
          "[sticker]",
          "Hello there",
          literalCaption,
          "[sticker: fox]",
          "[sticker: Missing picture]",
          "Multiple stickers",
        ]);
        await expect(page.locator(".chan__bubble")).toHaveCount(10);
        await expect(page.locator(".chan__msgs, .chat__scroll")).not.toContainText("named_by");
        await expect(page.locator(".chan__msgs, .chat__scroll")).not.toContainText('trust="untrusted"');
        const contact = page.getByRole("complementary", {
          name: language === "es" ? "Contacto" : "Contact",
          exact: true,
        });
        if (await contact.count()) {
          await contact.getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true }).click();
        }
        await expect(contact).toHaveCount(0);
        const news = page.getByRole("complementary", {
          name: language === "es" ? "Novedades e invitaciones" : "News and invitations",
          exact: true,
        });
        if (await news.isVisible())
          await news.getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true }).click();
        await expect(page.getByText(literalCaption, { exact: true })).toBeVisible();
        await page.locator(".chan__bubble").first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`unnamed-${language}-${width}.png`) });
        await page.getByText(literalCaption, { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`channel-${language}-${width}.png`) });
        const settings = language === "es" ? "Configuración del canal" : "Channel settings";
        if (width === 390) {
          await page.goto(`${fixture.url}/?lang=${language}#channel=test`);
          await page.locator(".chan__switch").click();
          await page.getByRole("menuitem", { name: settings, exact: true }).click();
        } else {
          await page.getByRole("button", { name: settings, exact: true }).click();
        }
        await page
          .locator(".config__nav")
          .getByRole("button", { name: language === "es" ? "Stickers y emojis" : "Stickers and emoji", exact: true })
          .click();
        const adult = page.locator(".stk__row").filter({ hasText: language === "es" ? "+18" : "18+" });
        await expect(adult).toBeVisible();
        await expect(adult.getByRole("switch")).not.toBeChecked();
        await page.screenshot({ path: info.outputPath(`adult-catalog-${language}-${width}.png`) });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true })
          .click();
        await page.goto(`${fixture.url}/?lang=${language}#thread=${fixture.thread}`);
        await expect(page.getByText(literalCaption, { exact: true })).toBeVisible();
        await expect(page.getByText("[sticker: fox]", { exact: true })).toBeVisible();
        await expect(page.locator(".chan__msgs, .chat__scroll")).not.toContainText("named_by");
        await expect(page.locator(".chan__msgs, .chat__scroll")).not.toContainText("[sticker (18+):");
        await page.screenshot({ path: info.outputPath(`transcript-${language}-${width}.png`) });
        // The phone shows either the chat or its Inbox: return to the list to inspect the grouped row.
        await page.goto(`${fixture.url}/?lang=${language}`);
        if (width < 600) {
          await page
            .getByRole("button", { name: language === "es" ? "Volver a los chats" : "Back to the chats", exact: true })
            .click();
        }
        const heads = page.locator(".channelbundle__head");
        await expect(heads).toHaveCount(10);
        await expect(heads.filter({ has: page.getByText("Named literal", { exact: true }) })).toContainText(
          '<sticker named_by="',
        );
        await expect(heads.filter({ hasText: "Cut named opening" })).not.toContainText("<");
        await expect(heads.filter({ hasText: "Short opening" })).not.toContainText("<");
        await expect(heads.filter({ hasText: "Short literal" })).toContainText("<stic");
        await expect(heads.filter({ hasText: "Delivery line" })).toContainText("[sticker: A friendly mascot]");
        await expect(heads.filter({ hasText: "Partial opening" })).not.toContainText("<");
        await expect(heads.filter({ hasText: "Partial closing" })).toContainText("[sticker: A friendly mascot]");
        await expect(heads.filter({ hasText: "Partial closing" })).not.toContainText("<");
        await expect(heads.filter({ hasText: "Literal text" })).toContainText("Literal <stic and <");
        await page.screenshot({ path: info.outputPath(`grouped-${language}-${width}.png`) });
        await page.goto(`${fixture.url}/?lang=${language}#channel=literal-cap`);
        await expect(page.locator(".chan__preview")).toContainText("<stic");
        await page.screenshot({ path: info.outputPath(`literal-${language}-${width}.png`) });
        await page.goto(`${fixture.url}/?lang=${language}#channel=literal-named-cap`);
        await expect(page.locator(".chan__preview")).toContainText('<sticker named_by="');
        await page.screenshot({ path: info.outputPath(`named-literal-${language}-${width}.png`) });
      }
    }
    const kept = await client.call("threads.get", { thread: fixture.thread });
    const captionWithNote = kept.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "text" && p.text === "[sticker]\n[sticker]");
    expect(captionWithNote?.type === "text" && captionWithNote.attachment_notes).toEqual(["[sticker]"]);
    expect(kept.thread.preview).toBe(fixture.raw.slice(0, 160));
    expect(kept.messages.flatMap((m) => m.parts).some((p) => p.type === "text" && p.text === fixture.raw)).toBe(true);
  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
    await h?.close();
  }
});
