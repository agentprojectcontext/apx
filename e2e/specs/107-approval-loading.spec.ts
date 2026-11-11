import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** Settings › Browser, where the pages agents may run JavaScript on are listed. */
async function openBrowserSettings(page: Page, spanish: boolean) {
  await page.getByRole("button", { name: spanish ? /^Cuenta/ : /^Account/ }).click();
  await page.getByRole("menuitem", { name: spanish ? /^Configuración(?! inicial)/ : /^Settings/ }).click();
  await page
    .getByRole("dialog", { name: spanish ? "Configuración" : "Settings" })
    .getByRole("button", { name: spanish ? "Navegador" : "Browser", exact: true })
    .click();
}

for (const failed of [false, true]) {
  test(`open browser permissions unmount while their new language ${failed ? "fails" : "loads"}`, async ({
    page,
  }, info) => {
    await rpc("setup.finish", {});
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("approvalLanguageSeeded")) {
        localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" }));
        sessionStorage.setItem("approvalLanguageSeeded", "true");
      }
      sessionStorage.setItem("apx.preloadReload", String(Date.now()));
    });
    let releaseBase!: () => void;
    const base = new Promise<void>((resolve) => {
      releaseBase = resolve;
    });
    let releasePack!: () => void;
    const pack = new Promise<void>((resolve) => {
      releasePack = resolve;
    });
    let fail = failed;
    await page.route(/\/es-[A-Za-z0-9_-]+\.js$/, async (route) => {
      await base;
      await route.continue();
    });
    await page.route("**/approvals-es-*.js", async (route) => {
      await pack;
      if (fail)
        await route.fulfill({ contentType: "application/javascript", body: 'throw new Error("Options unavailable");' });
      else await route.continue();
    });
    await open(page);
    try {
      await page.getByRole("button", { name: /^Account/ }).click();
      await page.getByRole("menuitem", { name: /^Language/ }).hover();
      await page.getByRole("menuitem", { name: "Español", exact: true }).click();
      await openBrowserSettings(page, false);
      await expect(page.getByRole("region", { name: "JavaScript on pages" })).toBeVisible();
      releaseBase();
      await expect(page.getByRole("status").filter({ hasText: "Cargando permisos de JavaScript…" })).toBeVisible();
      await expect(page.getByRole("region", { name: /JavaScript on pages|JavaScript en páginas/ })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("open-permissions-language-loading.png"), fullPage: true });
    } finally {
      releaseBase();
      releasePack();
    }
    if (failed) {
      const alert = page.getByRole("alert").filter({ hasText: "No se pudieron mostrar los permisos de JavaScript" });
      await expect(alert).toBeVisible();
      await expect(page.getByRole("region", { name: "JavaScript en páginas" })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("open-permissions-language-failure.png"), fullPage: true });
      fail = false;
      await alert.getByRole("button", { name: "Reintentar", exact: true }).click();
      await openBrowserSettings(page, true);
    }
    const region = page.getByRole("region", { name: "JavaScript en páginas" });
    await expect(region).toBeVisible();
    await expect(region).not.toContainText("res.browser");
  });
}

for (const language of ["en", "es"] as const) {
  for (const screen of ["settings", "question"] as const) {
    test(`${screen} keeps approval loading and failure visible in ${language}, then recovers`, async ({
      page,
    }, info) => {
      const spanish = language === "es";
      await page.setViewportSize({ width: spanish ? 390 : 1280, height: 900 });
      const loading =
        screen === "settings"
          ? spanish
            ? "Cargando permisos de JavaScript…"
            : "Loading JavaScript permissions…"
          : spanish
            ? "Cargando opciones…"
            : "Loading options…";
      const failure =
        screen === "settings"
          ? spanish
            ? "No se pudieron mostrar los permisos de JavaScript. Recargá para volver a intentarlo."
            : "Could not show JavaScript permissions. Reload to try again."
          : spanish
            ? "No se pudieron mostrar estas opciones. Recargá para volver a intentarlo."
            : "These options could not be shown. Reload to try again.";
      const permissions = spanish ? "JavaScript en páginas" : "JavaScript on pages";
      await rpc("setup.finish", {});
      await page.addInitScript((language) => {
        localStorage.setItem("apx.prefs", JSON.stringify({ language }));
        sessionStorage.setItem("apx.preloadReload", String(Date.now()));
      }, language);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let fail = true;
      await page.route(`**/approvals-${language}-*.js`, async (route) => {
        if (!fail) return route.continue();
        await held;
        await route.fulfill({ contentType: "application/javascript", body: 'throw new Error("Options unavailable");' });
      });
      let hash = "";
      if (screen === "question") {
        const chat = await rpc<{ id: string }>("threads.create", {
          kind: "loose",
          agent_id: "scout",
          title: "Review days",
        });
        hash = `#thread=${chat.id}`;
        await rpc("threads.send", { thread: chat.id, text: "ask me which days" });
      }
      await open(page, hash);
      if (screen === "settings") await openBrowserSettings(page, spanish);
      try {
        await expect(page.getByRole("status").filter({ hasText: loading })).toBeVisible();
        await expect(page.locator(".inputcard")).toHaveCount(0);
        await expect(page.getByRole("region", { name: permissions })).toHaveCount(0);
      } finally {
        release();
      }
      const alert = page.getByRole("alert").filter({ hasText: failure });
      await expect(alert).toBeVisible();
      await page.screenshot({ path: info.outputPath(`options-failure-${screen}-${language}.png`), fullPage: true });
      await expect(page.locator(".inputcard")).toHaveCount(0);
      fail = false;
      await alert.getByRole("button", { name: spanish ? "Reintentar" : "Retry", exact: true }).click();
      if (screen === "settings") {
        await openBrowserSettings(page, spanish);
        await expect(page.getByRole("region", { name: permissions })).toBeVisible();
      } else {
        const card = page.locator(".inputcard.is-pending");
        await expect(card).toContainText("Which days work for the Northwind review?");
        await expect(card.getByRole("button", { name: spanish ? "Enviar" : "Send", exact: true })).toBeDisabled();
        await card.getByRole("button", { name: "Monday", exact: true }).click();
        await expect(card.getByRole("button", { name: spanish ? "Enviar" : "Send", exact: true })).toBeEnabled();
      }
      if (screen === "settings") await page.keyboard.press("Escape");
      const nextLanguage = spanish ? "en" : "es";
      let releaseLanguage!: () => void;
      const heldLanguage = new Promise<void>((resolve) => {
        releaseLanguage = resolve;
      });
      await page.route(`**/approvals-${nextLanguage}-*.js`, async (route) => {
        await heldLanguage;
        await route.continue();
      });
      await page.getByRole("button", { name: spanish ? /^Cuenta/ : /^Account/ }).click();
      await page.getByRole("menuitem", { name: spanish ? /^Idioma/ : /^Language/ }).hover();
      await page.getByRole("menuitem", { name: spanish ? "English" : "Español", exact: true }).click();
      if (screen === "settings") await openBrowserSettings(page, !spanish);
      try {
        await expect(
          page.getByRole("status").filter({
            hasText:
              screen === "settings"
                ? spanish
                  ? "Loading JavaScript permissions…"
                  : "Cargando permisos de JavaScript…"
                : spanish
                  ? "Loading options…"
                  : "Cargando opciones…",
          }),
        ).toBeVisible();
        await expect(page.locator(".inputcard")).toBeHidden();
        await expect(page.getByRole("region", { name: permissions })).toBeHidden();
      } finally {
        releaseLanguage();
      }
      if (screen === "settings") {
        await expect(
          page.getByRole("region", { name: spanish ? "JavaScript on pages" : "JavaScript en páginas" }),
        ).toBeVisible();
      } else {
        const card = page.locator(".inputcard.is-pending");
        await expect(card.getByRole("button", { name: spanish ? "Send" : "Enviar", exact: true })).toBeEnabled();
        await expect(card.getByRole("button", { name: "Monday", exact: true })).toHaveAttribute("aria-pressed", "true");
      }
    });
  }
}
