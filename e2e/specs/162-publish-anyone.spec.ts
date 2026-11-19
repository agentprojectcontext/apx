// Share › Anyone with the link is the public copy at apxagent.app. Signed out, the same dialog signs in (APX joined to
// Google) and carries on by itself once the browser is done; signed in, it goes straight to what goes in the copy,
// its review and the link. The account and the cloud are stand-ins: no Google account or public copy is touched.
import type { Page, Route } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

const CODE = "k3x9q2m7";
const URL = `https://artifact.apxagent.app/${CODE}`;
const DRAFT = "6f1c2c8e-8a43-4d4b-9a8e-2f4a3d1b7c55";
const PROFILE = { id: "abcd2345", name: "Acme", photo: "", handle: "" };
const ok = (result: unknown) => (route: Route) => route.fulfill({ json: { ok: true, result } });

async function standIns(page: Page, surface: string, state: { profile: object | null; published: boolean }) {
  // As the core: from account.start until the browser is done, the sign-in is pending.
  let pending = false;
  await page.route("**/rpc/account.get", (route) =>
    ok({ available: true, profile: state.profile, pending: pending && !state.profile, unreadable: false })(route),
  );
  await page.route("**/rpc/account.start", (route) => {
    pending = true;
    return ok({ url: "about:blank#google" })(route);
  });
  await page.route("**/rpc/surfaces.public_list", (route) =>
    ok(
      state.published
        ? {
            items: [
              {
                code: CODE,
                surface,
                url: URL,
                title: "Sales board",
                bytes: 1200,
                updated_at: "2026-11-18T12:00:00.000Z",
              },
            ],
            count: 1,
            bytes: 1200,
          }
        : { items: [], count: 0, bytes: 0 },
    )(route),
  );
  const draft = {
    draft: DRAFT,
    action: "publish",
    code: CODE,
    url: URL,
    title: "Sales board",
    bytes: 1_200_000,
    state_keys: ["filters"],
    expires_at: "2026-11-30T12:00:00.000Z",
  };
  await page.route("**/rpc/surfaces.public_prepare", ok(draft));
  await page.route(
    "**/rpc/surfaces.public_preview",
    ok({
      ...draft,
      review_token: "0b6c3f4e-4f0a-4f8e-9f55-8f1d7c2a9e10",
      account: PROFILE,
      bundle: {
        format: "apx-artifact@1",
        manifest: { name: "sales-board", title: "Sales board", kind: "widget", version: 1 },
        html: "<h1>Sales board</h1>",
        state: { filters: { region: "north" } },
      },
    }),
  );
  await page.route("**/rpc/surfaces.public_discard", ok({ ok: true }));
  await page.route("**/rpc/surfaces.public_commit", ok({ code: CODE, url: URL, action: "publish" }));
}

for (const width of [1280, 390]) {
  test(`anyone with the link signs in where it is asked, then reviews and publishes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await rpc("setup.finish");
    const surface = await rpc<{ id: string }>("surfaces.show", {
      name: `publish-anyone-${width}`,
      title: "Sales board",
      html: "<h1>Sales board</h1>",
    });
    await rpc("surfaces.set_state", { surface: surface.id, patch: { filters: { region: "north" }, notes: "private" } });
    const state = { profile: null as object | null, published: false };
    await standIns(page, surface.id, state);
    try {
      await open(page, `#app=${surface.id}`);
      await page.getByRole("button", { name: /^Compartir/ }).click();
      await expect(page.getByRole("menuitem", { name: /^Publicar copia/ })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: /^Enlace en vivo desde esta compu…/ })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-menu-${width}.png`) });
      await page.getByRole("menuitem", { name: /^Cualquiera con el enlace/ }).click();

      const dialog = page.getByRole("dialog", { name: "Cualquiera con el enlace" });
      await expect(
        dialog.getByText("Antes de publicar tenés que iniciar sesión en APX con tu cuenta de Google."),
      ).toBeVisible();
      await expect(dialog.getByText(/Configuración/)).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`publish-signin-${width}.png`) });
      const google = page.waitForEvent("popup");
      await dialog.getByRole("button", { name: "Continuar con Google" }).click();
      await (await google).close();
      await expect(dialog.getByText(/Terminá de iniciar sesión en el navegador/)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`publish-waiting-${width}.png`) });

      // The browser finished: the dialog notices by itself and goes on to the copy.
      state.profile = PROFILE;
      await expect(dialog.getByText("Publicás como Acme")).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(/Sales board se copia tal como está ahora/)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`publish-choose-${width}.png`) });
      await dialog.getByRole("checkbox", { name: "filters" }).check();
      await dialog.getByRole("button", { name: "Revisar copia" }).click();

      const review = page.getByRole("dialog", { name: "Revisá la copia" });
      await expect(review.getByText(URL)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`publish-review-${width}.png`) });
      // As the cloud: once published, the copy is in the owner's list.
      state.published = true;
      await review.getByRole("button", { name: "Publicar", exact: true }).click();

      const done = page.getByRole("dialog", { name: "Ya es público" });
      await expect(done.getByText(URL)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`publish-done-${width}.png`) });
      await done.getByRole("button", { name: "Listo" }).click();

      await page.getByRole("button", { name: /^Compartido/ }).click();
      await expect(page.getByRole("menuitem", { name: "Cualquiera con el enlace ✓" })).toBeVisible();
      await expect(page.getByText(URL)).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Dejar de compartir…" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-menu-published-${width}.png`) });
    } finally {
      await rpc("surfaces.remove", { surface: surface.id });
    }
  });
}

test("a session APX keeps but cannot read says so on the account card, with the sign-in beside it", async ({
  page,
}) => {
  await page.route("**/rpc/account.get", ok({ available: true, profile: null, pending: false, unreadable: true }));
  await page.route("**/rpc/surfaces.public_list", ok({ items: [], count: 0, bytes: 0 }));
  await open(page);
  await openSettings(page);
  const card = page.getByRole("dialog", { name: "Configuración", exact: true }).getByRole("region", { name: "Cuenta" });
  await expect(card.getByText(/APX ya no puede leer tu sesión en esta compu/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Iniciar sesión con Google" })).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`each published copy is a card with its link and every action in view at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route(
      "**/rpc/account.get",
      ok({ available: true, profile: PROFILE, pending: false, unreadable: false }),
    );
    await page.route(
      "**/rpc/surfaces.public_list",
      ok({
        items: [
          { code: CODE, url: URL, title: "Sales board", bytes: 1200, updated_at: "2026-11-18T12:00:00.000Z" },
          {
            code: "m7q2x9k3",
            url: "https://artifact.apxagent.app/m7q2x9k3",
            title: "Team page",
            bytes: 54_000,
            updated_at: "2026-11-17T09:30:00.000Z",
          },
        ],
        count: 2,
        bytes: 55_200,
      }),
    );
    await page.route(
      "**/rpc/surfaces.public_prepare",
      ok({
        draft: DRAFT,
        action: "revoke",
        code: CODE,
        url: URL,
        title: "Sales board",
        bytes: 0,
        state_keys: [],
        expires_at: "2026-11-30T12:00:00.000Z",
      }),
    );
    await page.route(
      "**/rpc/surfaces.public_preview",
      ok({
        draft: DRAFT,
        action: "revoke",
        code: CODE,
        url: URL,
        title: "Sales board",
        bytes: 0,
        state_keys: [],
        expires_at: "2026-11-30T12:00:00.000Z",
        review_token: "0b6c3f4e-4f0a-4f8e-9f55-8f1d7c2a9e10",
      }),
    );
    await page.route("**/rpc/surfaces.public_discard", ok({ ok: true }));
    await open(page);
    await openSettings(page);
    // The stand-in account's name differs from the owner's: keep the owner's.
    await page.getByRole("button", { name: /^Dejar / }).click();
    const list = page.getByRole("region", { name: "Copias publicadas" });
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByText("Team page")).toBeVisible();
    await expect(list.getByRole("button", { name: "Copiar enlace" })).toHaveCount(2);
    await expect(list.getByRole("button", { name: "Dejar de compartir…" })).toHaveCount(2);
    await expect(list.getByRole("button", { name: "Administrar" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`published-cards-${width}.png`) });
    await list.getByRole("button", { name: "Dejar de compartir…" }).first().click();
    await expect(page.getByRole("dialog", { name: "Dejar de publicar" })).toBeVisible();
  });
}
