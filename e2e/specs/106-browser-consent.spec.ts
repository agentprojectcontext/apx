import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

for (const [width, scope, language] of [
  [1280, "tab", "es"],
  [390, "tab", "es"],
  [1280, "turn", "en"],
  [390, "tab", "en"],
] as const) {
  test(`browser consent ${language} at ${width}px shows its scope, runs three calls and exposes revocation`, async ({
    page,
  }, info) => {
    const spanish = language === "es";
    const permissions = spanish ? "JavaScript en páginas" : "JavaScript on pages";
    const revoke = spanish ? /^Revocar:/ : /^Revoke:/;
    const empty = spanish
      ? "Ningún agente puede ejecutar JavaScript en una página ahora sin preguntarte."
      : "No agent can run JavaScript on a page right now without asking you.";
    await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
    let failPermissions = false;
    let failRevocation = false;
    await page.route("**/rpc/tools.revoke", async (route) => {
      if (failRevocation)
        await route.fulfill({
          json: { ok: false, error: { code: "unavailable", message: "Revocation temporarily unavailable" } },
        });
      else await route.continue();
    });
    await page.route("**/rpc/tools.approvals", async (route) => {
      if (failPermissions)
        await route.fulfill({
          json: { ok: false, error: { code: "unavailable", message: "Permissions temporarily unavailable" } },
        });
      else await route.continue();
    });
    await rpc("setup.finish", {});
    const { core, token } = await world.info();
    const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
    let evaluations = 0;
    node.onRequest(async (method) => {
      if (method === "browser.tabs")
        return {
          tabs: [
            {
              tab: "consent-tab",
              url: "https://example.com/",
              title: "Example",
              profile: "shared",
              control: { kind: "idle" },
              consent_epoch: "epoch1",
            },
          ],
        };
      if (method === "browser.approval_context") return { epoch: "epoch1" };
      // Settings › Browser also offers to copy sessions from this computer's browsers: none here.
      if (method === "browser.cookie_sources") return { sources: [] };
      if (method === "browser.hold") return { ok: true };
      if (method === "browser.evaluate") {
        evaluations++;
        return { url: "https://example.com/", json: "42" };
      }
      throw new Error(`Unexpected ${method}`);
    });
    let thread: string | undefined;
    try {
      const reader = await rpc<{ id: string }>("agents.create", {
        slug: `browser-reader-${language}-${width}`,
        name: "Browser reader",
      });
      thread = (
        await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: reader.id, title: "Review page" })
      ).id;
      await page.setViewportSize({ width, height: 900 });
      await open(page, `#thread=${thread}`);
      await page.getByRole("textbox", { name: /Escribile|Message/ }).fill("evaluate browser three times");
      await page.keyboard.press("Enter");
      const card = page.locator(".inputcard.is-pending");
      const once = card.getByRole("button", { name: spanish ? "Aceptar una vez" : "Approve once", exact: true });
      await expect(once).toBeVisible();
      await expect(once).toHaveAttribute("aria-describedby", /.+/);
      await expect(
        card.getByRole("button", { name: spanish ? "Permitir en esta pestaña" : "Allow in this tab", exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: spanish ? "Durante este turno" : "During this turn", exact: true }),
      ).toBeVisible();
      await expect(card).toContainText("https://example.com");
      await expect(card).toContainText(spanish ? /código distinto/i : /different code/i);
      await expect(
        card.getByRole("textbox", { name: spanish ? "Código JavaScript completo" : "Full JavaScript source" }),
      ).toHaveValue("0");
      await once.focus();
      await expect(once).toBeFocused();
      await page.screenshot({ path: info.outputPath(`approval-${language}-${width}.png`), fullPage: true });
      await card
        .getByRole("button", {
          name: scope === "tab" ? (spanish ? "Permitir en esta pestaña" : "Allow in this tab") : "During this turn",
          exact: true,
        })
        .click();
      await expect(card).toBeHidden();
      await until(async () => evaluations === 3);
      await expect(page.locator(".inputline")).toHaveCount(1);
      // Settings › Browser lists it, read again on its own while shown.
      await page.getByRole("button", { name: spanish ? /^Cuenta/ : /^Account/ }).click();
      await page.getByRole("menuitem", { name: spanish ? /^Configuración(?! inicial)/ : /^Settings/ }).click();
      await page
        .getByRole("dialog", { name: spanish ? "Configuración" : "Settings" })
        .getByRole("button", { name: spanish ? "Navegador" : "Browser", exact: true })
        .click();
      const section = page.getByRole("region", { name: permissions });
      await expect(section).toBeVisible();
      await expect(
        section.getByRole("button", { name: spanish ? "Actualizar permisos" : "Refresh permissions" }),
      ).toHaveCount(0);
      if (scope === "tab") {
        await expect(section).toContainText("https://example.com");
        await expect(section.getByRole("button", { name: revoke })).toHaveAccessibleName(
          /example\.com.*Example.*(?:Pestaña|Tab) 1/,
        );
        await section.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`permissions-${language}-${width}.png`), fullPage: true });
        if (width === 390) {
          failRevocation = true;
          await section.getByRole("button", { name: revoke }).click();
          await expect(section.getByRole("alert")).toContainText(spanish ? "No se pudo revocar" : "Couldn’t revoke it");
          await expect(section).toContainText("https://example.com");
          expect(await page.getByText("Revocation temporarily unavailable", { exact: false }).count()).toBe(0);
          await page.screenshot({ path: info.outputPath(`error-revoke-${language}-390.png`), fullPage: true });
          failRevocation = false;
        }
        await section.getByRole("button", { name: revoke }).click();
        await expect(section.getByRole("status")).toContainText(spanish ? "Revocado" : "Revoked");
        await expect(section.getByRole("alert")).toHaveCount(0);
      }
      await expect(section.getByRole("button", { name: revoke })).toHaveCount(0);
      await expect(section).toContainText(empty);
      await page.screenshot({ path: info.outputPath(`empty-${language}-${width}.png`), fullPage: true });
      if (width === 390) {
        failPermissions = true;
        await expect(section.getByRole("alert")).toContainText(
          spanish ? "No se pudieron cargar" : "Couldn’t load them",
          { timeout: 15_000 },
        );
        expect(await page.getByText("Permissions temporarily unavailable", { exact: false }).count()).toBe(0);
        await page.screenshot({ path: info.outputPath(`error-load-${language}-390.png`), fullPage: true });
        failPermissions = false;
        await expect(section.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
        await expect(section).toContainText(empty);
      }
      await page.keyboard.press("Escape");
      await expect(section).toBeHidden();
    } finally {
      if (thread) await rpc("threads.cancel", { thread });
      node.close();
      await node.closed;
    }
  });
}
