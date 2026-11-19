// Share asks one thing, who can see it: only you, public (a copy at apxagent.app) or live from this computer, each with
// its link. Public signs in first when needed (APX joined to Google) and carries on by itself; then one step shows the
// copy, a switch for the widget's saved data, and shares it. The account and the cloud are stand-ins.
import type { Page, Route } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

const CODE = "k3x9q2m7";
const URL = `https://artifact.apxagent.app/${CODE}`;
const DRAFT = "6f1c2c8e-8a43-4d4b-9a8e-2f4a3d1b7c55";
const PROFILE = { id: "abcd2345", name: "Acme", photo: "", handle: "" };
const ok = (result: unknown) => (route: Route) => route.fulfill({ json: { ok: true, result } });

type State = { profile: object | null; published: boolean; prepared: string[] };

async function standIns(page: Page, surface: string, state: State) {
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
  // Each prepare answers the action and the saved data it was asked for, as the core does.
  let action = "publish";
  let keys: string[] = [];
  const draft = () => ({
    draft: DRAFT,
    action,
    code: CODE,
    url: URL,
    title: "Sales board",
    bytes: keys.length ? 1_300_000 : 1_200_000,
    state_keys: keys,
    expires_at: "2026-11-30T12:00:00.000Z",
  });
  await page.route("**/rpc/surfaces.public_prepare", (route) => {
    const body = route.request().postDataJSON() as { action: string; state_keys?: string[] };
    action = body.action;
    keys = body.state_keys ?? [];
    state.prepared.push(keys.join(","));
    return ok(draft())(route);
  });
  await page.route("**/rpc/surfaces.public_preview", (route) =>
    ok({
      ...draft(),
      review_token: "0b6c3f4e-4f0a-4f8e-9f55-8f1d7c2a9e10",
      account: PROFILE,
      ...(action === "revoke"
        ? {}
        : {
            bundle: {
              format: "apx-artifact@1",
              manifest: { name: "sales-board", title: "Sales board", kind: "widget", version: 1 },
              html: "<h1>Sales board</h1>",
              ...(keys.length ? { state: { filters: { region: "north" } } } : {}),
            },
          }),
    })(route),
  );
  await page.route("**/rpc/surfaces.public_discard", ok({ ok: true }));
  await page.route("**/rpc/surfaces.public_commit", (route) => ok({ code: CODE, url: URL, action })(route));
}

for (const width of [1280, 390]) {
  test(`share asks who can see it, signs in where it is asked and shares public in one step at ${width}px`, async ({
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
    const state: State = { profile: null, published: false, prepared: [] };
    await standIns(page, surface.id, state);
    try {
      await open(page, `#app=${surface.id}`);
      await page.getByRole("button", { name: /^Compartir/ }).click();
      const who = page.getByRole("combobox", { name: "Quién lo puede ver" });
      await expect(who).toHaveText(/Solo vos/);
      await expect(page.getByRole("button", { name: "Copiar enlace privado" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-private-${width}.png`) });
      await page.getByRole("radio", { name: "Exportar" }).click();
      await expect(page.getByText("Archivo de APX", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Descargar Archivo de APX", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-export-${width}.png`) });
      await page.getByRole("radio", { name: "Compartir" }).click();
      await who.click();
      await expect(page.getByRole("option", { name: /En vivo desde esta compu/ })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-choices-${width}.png`) });
      await page.getByRole("option", { name: /^Público/ }).click();

      const signIn = page.getByRole("dialog", { name: "Iniciar sesión para compartir público" });
      await expect(
        signIn.getByText("Para compartirlo público, iniciá sesión en APX con Google. Es una sola vez."),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-signin-${width}.png`) });
      const google = page.waitForEvent("popup");
      await signIn.getByRole("button", { name: "Continuar con Google" }).click();
      await (await google).close();
      await expect(signIn.getByText(/Terminá de iniciar sesión en el navegador/)).toBeVisible();

      // The browser finished: the dialog notices by itself and shows the copy, without the saved data.
      state.profile = PROFILE;
      const share = page.getByRole("dialog", { name: "Compartir público" });
      await expect(share.getByTitle("Vista previa de la página publicada")).toBeVisible({ timeout: 10_000 });
      await expect(share.getByText(/Pesa 1,1 MB/)).toBeVisible();
      expect(state.prepared).toEqual([""]);
      await share.getByRole("switch", { name: /Incluir los datos que guardó el widget/ }).click();
      await expect(share.getByText(/Pesa 1,2 MB/)).toBeVisible();
      expect(state.prepared.at(-1)).toBe("filters,notes");
      await page.screenshot({ path: info.outputPath(`share-confirm-${width}.png`) });
      state.published = true;
      await share.getByRole("button", { name: "Compartir público", exact: true }).click();
      await expect(page.getByText(/Ya es público/).first()).toBeVisible();

      await page.getByRole("button", { name: /^Compartido/ }).click();
      await expect(page.getByRole("combobox", { name: "Quién lo puede ver" })).toHaveText(/Público/);
      await expect(page.getByText("artifact.apxagent.app/k3x9q2m7")).toBeVisible();
      await expect(page.getByRole("button", { name: "Copiar enlace público" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Actualizar con tus cambios…" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-public-${width}.png`) });

      await page.getByRole("combobox", { name: "Quién lo puede ver" }).click();
      await page.getByRole("option", { name: /^Solo vos/ }).click();
      const stop = page.getByRole("dialog", { name: "¿Dejar de compartir?" });
      await expect(stop.getByRole("button", { name: "Dejar de compartir" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`share-stop-${width}.png`) });
    } finally {
      await rpc("surfaces.remove", { surface: surface.id });
    }
  });
}

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
    await expect(page.getByRole("dialog", { name: "¿Dejar de compartir?" })).toBeVisible();
  });
}
