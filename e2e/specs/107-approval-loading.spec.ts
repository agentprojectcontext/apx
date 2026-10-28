import { expect, open, rpc, test } from "./kit.ts";

for (const failed of [false, true]) {
  test(`an open permissions dialog unmounts while its new language ${failed ? "fails" : "loads"}`, async ({
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
    await open(page, "#view=resources");
    try {
      await page.getByRole("button", { name: /^Account/ }).click();
      await page.getByRole("menuitem", { name: "Language", exact: true }).hover();
      await page.getByRole("menuitem", { name: "Español", exact: true }).click();
      await page.getByRole("button", { name: "Active browser permissions", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      releaseBase();
      await expect(page.getByRole("status").filter({ hasText: "Cargando permisos del navegador…" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh permissions", exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("open-dialog-language-loading.png"), fullPage: true });
    } finally {
      releaseBase();
      releasePack();
    }
    if (failed) {
      const alert = page.getByRole("alert").filter({ hasText: "No se pudieron mostrar los permisos del navegador" });
      await expect(alert).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("open-dialog-language-failure.png"), fullPage: true });
      fail = false;
      await alert.getByRole("button", { name: "Reintentar", exact: true }).click();
    }
    await page.getByRole("button", { name: "Permisos activos del navegador", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Actualizar permisos", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("res.browser");
  });
}

for (const language of ["en", "es"] as const) {
  for (const screen of ["resources", "question"] as const) {
    test(`${screen} keeps approval loading and failure visible in ${language}, then recovers`, async ({
      page,
    }, info) => {
      const spanish = language === "es";
      await page.setViewportSize({ width: spanish ? 390 : 1280, height: 900 });
      const loading =
        screen === "resources"
          ? spanish
            ? "Cargando permisos del navegador…"
            : "Loading browser permissions…"
          : spanish
            ? "Cargando opciones…"
            : "Loading options…";
      const failure =
        screen === "resources"
          ? spanish
            ? "No se pudieron mostrar los permisos del navegador. Recargá para volver a intentarlo."
            : "Could not show browser permissions. Reload to try again."
          : spanish
            ? "No se pudieron mostrar estas opciones. Recargá para volver a intentarlo."
            : "These options could not be shown. Reload to try again.";
      const permissions = spanish ? "Permisos activos del navegador" : "Active browser permissions";
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
      let hash = "#view=resources";
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
      try {
        await expect(page.getByRole("status").filter({ hasText: loading })).toBeVisible();
        await expect(page.locator(".inputcard")).toHaveCount(0);
        await expect(page.getByRole("button", { name: permissions, exact: true })).toHaveCount(0);
      } finally {
        release();
      }
      const alert = page.getByRole("alert").filter({ hasText: failure });
      await expect(alert).toBeVisible();
      await page.screenshot({ path: info.outputPath(`options-failure-${screen}-${language}.png`), fullPage: true });
      await expect(page.locator(".inputcard")).toHaveCount(0);
      fail = false;
      await alert.getByRole("button", { name: spanish ? "Reintentar" : "Retry", exact: true }).click();
      if (screen === "resources") {
        await page.getByRole("button", { name: permissions, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else {
        const card = page.locator(".inputcard.is-pending");
        await expect(card).toContainText("Which days work for the Northwind review?");
        await expect(card.getByRole("button", { name: spanish ? "Enviar" : "Send", exact: true })).toBeDisabled();
        await card.getByRole("button", { name: "Monday", exact: true }).click();
        await expect(card.getByRole("button", { name: spanish ? "Enviar" : "Send", exact: true })).toBeEnabled();
      }
      if (screen === "resources")
        await page
          .getByRole("dialog")
          .getByRole("button", { name: spanish ? "Cerrar" : "Close", exact: true })
          .click();
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
      await page.getByRole("menuitem", { name: spanish ? "Idioma" : "Language", exact: true }).hover();
      await page.getByRole("menuitem", { name: spanish ? "English" : "Español", exact: true }).click();
      try {
        await expect(
          page.getByRole("status").filter({
            hasText:
              screen === "resources"
                ? spanish
                  ? "Loading browser permissions…"
                  : "Cargando permisos del navegador…"
                : spanish
                  ? "Loading options…"
                  : "Cargando opciones…",
          }),
        ).toBeVisible();
        await expect(page.locator(".inputcard")).toBeHidden();
        await expect(page.getByRole("button", { name: permissions, exact: true })).toBeHidden();
      } finally {
        releaseLanguage();
      }
      if (screen === "resources") {
        await expect(
          page.getByRole("button", {
            name: spanish ? "Active browser permissions" : "Permisos activos del navegador",
            exact: true,
          }),
        ).toBeVisible();
      } else {
        const card = page.locator(".inputcard.is-pending");
        await expect(card.getByRole("button", { name: spanish ? "Send" : "Enviar", exact: true })).toBeEnabled();
        await expect(card.getByRole("button", { name: "Monday", exact: true })).toHaveAttribute("aria-pressed", "true");
      }
    });
  }
}
