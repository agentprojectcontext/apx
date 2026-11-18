// Account: the owner picks their agents' language and their time zone from searchable lists; Advanced says in words
// what each part of the core is doing; outside apps get their API token in a page of their own.
import { expect, open, rpc, test } from "./kit.ts";

type Owner = { language: string; timezone: string };

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`cloud account is optional and explains unavailable sign-in at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page
      .getByRole("textbox", { name: "Buscar" })
      .or(page.getByRole("combobox", { name: "Buscar" }))
      .fill("cuenta");
    await page.getByRole("option", { name: /Cuenta/ }).click();
    const account = page.getByRole("region", { name: "Cuenta en la nube", exact: true });
    await account.scrollIntoViewIfNeeded();
    await expect(account.getByRole("button", { name: "Iniciar sesión con Google" })).toBeDisabled();
    await expect(account.getByText(/Podés seguir usando APX sin cuenta/)).toBeVisible();
    await expect(account.getByText(/computadora donde corre APX/)).toBeVisible();
    expect((await rpc<{ profile: unknown }>("account.get")).profile).toBeNull();
    await page.screenshot({ path: testInfo.outputPath(`cloud-account-${viewport.width}.png`) });
  });
}

test("account read errors reload the account while failed username edits retry through Save", async ({
  page,
}, testInfo) => {
  let readFails = true;
  let saves = 0;
  await page.route("**/rpc/surfaces.public_list", (route) =>
    route.fulfill({ json: { ok: true, result: { items: [], count: 0, limit: 20 } } }),
  );
  const profile = { id: "0123abcd", name: "Acme Owner", photo: "", handle: "" };
  await page.route("**/rpc/account.get", (route) =>
    route.fulfill({
      json: readFails
        ? { ok: false, error: { code: "unavailable", message: "Account unavailable" } }
        : { ok: true, result: { available: true, profile } },
    }),
  );
  await page.route("**/rpc/account.rename", (route) => {
    saves++;
    if (saves > 1) profile.handle = "acme";
    return route.fulfill({
      json:
        saves === 1
          ? { ok: false, error: { code: "unavailable", message: "Account unavailable" } }
          : { ok: true, result: { profile } },
    });
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("textbox", { name: "Buscar" })
    .or(page.getByRole("combobox", { name: "Buscar" }))
    .fill("cuenta");
  await page.getByRole("option", { name: /Cuenta/ }).click();
  const account = page.getByRole("region", { name: "Cuenta en la nube", exact: true });
  const reload = account.getByRole("button", { name: "Volver a cargar la cuenta" });
  await expect(reload).toBeVisible();
  readFails = false;
  await reload.click();
  await expect(account.getByText("Tu ID de APX: 0123abcd")).toBeVisible();
  await expect(account.getByRole("alert")).toHaveCount(0);
  await page
    .getByText("Quién sos, para el panel y para tus agentes. Tu perfil local queda en esta computadora.", {
      exact: true,
    })
    .waitFor();
  await account.getByRole("textbox", { name: "Nombre de usuario" }).fill("acme");
  await account.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(account.getByRole("alert")).toBeVisible();
  await expect(reload).toHaveCount(0);
  await expect(account.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await account.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(account.getByRole("status")).toHaveText("Nombre de usuario guardado.");
  expect(saves).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await account.getByRole("textbox", { name: "Nombre de usuario" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("account-recovery-390.png") });
});

test("time zone and language are picked by searching, Advanced names each part of the core, and an API token is made in its own page", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("cuenta");
  await page.getByRole("option", { name: /Cuenta/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });

  await dialog.getByRole("combobox", { name: "Zona horaria" }).click();
  await page.getByPlaceholder("Buscá una ciudad o país").fill("madrid");
  await page.getByRole("option", { name: /Madrid/ }).click();
  await expect.poll(async () => (await rpc<Owner>("owner.get")).timezone).toBe("Europe/Madrid");

  await dialog.getByRole("combobox", { name: "Idioma de tus agentes" }).click();
  await page.getByPlaceholder("Buscá un idioma").fill("portu");
  await page.getByRole("option", { name: /Português/ }).click();
  await expect.poll(async () => (await rpc<Owner>("owner.get")).language).toBe("pt");
  await rpc("owner.set", { language: "es", timezone: "" });

  await dialog.getByRole("button", { name: /^Avanzado/ }).click();
  await expect(dialog.getByText("Nodo de navegador")).toBeVisible();

  await dialog.getByRole("button", { name: /^Tokens de API/ }).click();
  await dialog.getByRole("textbox", { name: "Nombre de la app" }).fill("Northwind CLI");
  await dialog.getByRole("button", { name: "Crear token" }).click();
  await expect(dialog.getByText(/APX_CLIENT_TOKEN=.* apx mcp/)).toBeVisible();
  await expect
    .poll(async () => (await rpc<{ clients: Array<{ name: string }> }>("clients.list")).clients.map((c) => c.name))
    .toContain("Northwind CLI");
});

test("an API client can be restricted to browser access and revoked", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("cuenta");
  await page.getByRole("option", { name: /Cuenta/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("button", { name: /^Tokens de API/ }).click();

  await dialog.getByRole("textbox", { name: "Nombre de la app" }).fill("Northwind browser client");
  await dialog.getByRole("checkbox", { name: "Chat" }).uncheck();
  await dialog.getByRole("checkbox", { name: "Navegador" }).check();
  await dialog.getByRole("button", { name: "Crear token" }).click();
  await expect(dialog.getByText(/APX_CLIENT_TOKEN=.* apx mcp/)).toBeVisible();
  const client = (
    await rpc<{ clients: Array<{ id: string; name: string; scopes: string[] }> }>("clients.list")
  ).clients.find((c) => c.name === "Northwind browser client");
  expect(client?.scopes).toEqual(["browser"]);

  await dialog.getByRole("button", { name: "Listo" }).click();
  const clientRow = dialog.locator(".tgtoken").filter({ hasText: "Northwind browser client" });
  await expect(clientRow.getByRole("button", { name: "Revocar" })).toBeVisible();
  await clientRow.getByRole("button", { name: "Revocar" }).click();
  await expect
    .poll(async () => (await rpc<{ clients: Array<{ id: string }> }>("clients.list")).clients.map((c) => c.id))
    .not.toContain(client?.id);
});
