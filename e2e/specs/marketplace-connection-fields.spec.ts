import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test.use({
  expectedConsoleErrors: [
    {
      path: "/rpc/extensions.settings",
      text: "Failed to load resource: the server responded with a status of 400 (Bad Request)",
    },
  ],
});

for (const language of ["en", "es"] as const) {
  test(`an updated extension asks for fresh connection fields in the panel language (${language})`, async ({
    page,
  }) => {
    const id = `northwind-${language}`;
    const setup = await rpc<Record<string, unknown>>("setup.status");
    await page.route("**/rpc/setup.status", (route) =>
      route.fulfill({ json: { ok: true, result: { ...setup, done: true } } }),
    );
    const { dir } = await world.info();
    const root = path.join(dir, id);
    const connections = (version: string) => ({
      store: { url: `https://store.example.invalid/${version}` },
      inventory: { url: `https://inventory.example.invalid/${version}` },
    });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id,
        name: "Northwind Store",
        version: "1.0.0",
        mcp: connections("v1"),
        settings: [
          { name: "host", label: "Store host", type: "string", required: true },
          { name: "legacy_auth", label: "Legacy credential", type: "string", required: true, sensitive: true },
        ],
      }),
    );
    await rpc("extensions.install", { path: root });
    await rpc("extensions.settings", {
      id,
      values: { host: "legacy.example.com/store", legacy_auth: "fixture-only" },
    });
    fs.writeFileSync(
      path.join(root, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id,
        name: "Northwind Store",
        version: "1.1.0",
        mcp: connections("v2"),
        settings: [
          {
            name: "site",
            type: "string",
            format: "https-url",
            required: true,
            label: "Store address",
            description: "Enter the full HTTPS address.",
            locales: {
              es: { label: "Dirección de la tienda", description: "Ingresá la dirección completa con HTTPS." },
            },
          },
          {
            name: "username",
            type: "string",
            required: true,
            label: "Username",
            locales: { es: { label: "Usuario" } },
          },
          {
            name: "credential",
            type: "string",
            required: true,
            sensitive: true,
            boundTo: ["site", "username"],
            label: "Application password",
            description: "Create it in your profile.",
            locales: { es: { label: "Contraseña de aplicación", description: "Creala en tu perfil." } },
          },
        ],
      }),
    );
    await rpc("extensions.install", { path: root });
    await page.addInitScript((language) => {
      const current = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
      localStorage.setItem("apx.prefs", JSON.stringify({ ...current, language }));
    }, language);
    await open(page, `#view=marketplace&item=ext%3A${id}`);
    const spanish = language === "es";
    const connect = spanish ? "Conectar" : "Connect";
    await page.getByRole("button", { name: spanish ? "Ver qué cambia" : "See what changes", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `${connect} Northwind Store` });
    await expect(dialog).toContainText(
      spanish ? "Volvé a conectarla con una credencial nueva." : "Reconnect with a new credential.",
    );
    await expect(dialog).toContainText(
      spanish ? "Cambia cómo se conecta: store · inventory" : "Changes how it connects: store · inventory",
    );
    await expect(dialog).toContainText("Legacy credential");
    const submit = dialog.getByRole("button", { name: connect, exact: true });
    const address = dialog.getByLabel(spanish ? "Dirección de la tienda" : "Store address", { exact: true });
    const username = dialog.getByLabel(spanish ? "Usuario" : "Username", { exact: true });
    const credential = dialog.getByLabel(spanish ? "Contraseña de aplicación" : "Application password", {
      exact: true,
    });
    await expect(dialog).toContainText(
      spanish ? "Ingresá la dirección completa con HTTPS." : "Enter the full HTTPS address.",
    );
    await expect(dialog).toContainText(spanish ? "Creala en tu perfil." : "Create it in your profile.");
    await expect(credential).toHaveAttribute("type", "password");
    await expect(address).toHaveValue("");
    await expect(credential).toHaveValue("");
    await expect(dialog.getByLabel("Legacy credential")).toHaveCount(0);
    await expect(submit).toBeDisabled();
    await address.fill("https://shop.example.com");
    await username.fill("northwind-test");
    await expect(submit).toBeDisabled();
    await credential.fill("fixture-only-not-a-credential");
    await expect(submit).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(submit).toBeInViewport();
    await address.fill("http://shop.example.com");
    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText(
      spanish ? "Revisá lo que ingresaste" : "Check the information you entered",
    );
    await expect(address).toBeEditable();

    await dialog.getByRole("button", { name: spanish ? "Cerrar" : "Close", exact: true }).click();
    await rpc("extensions.settings", {
      id,
      values: { site: "https://shop.example.com", username: "northwind-test", credential: "fixture-only" },
    });
    await open(page, `#view=marketplace&item=ext%3A${id}`);
    await page
      .locator(".mkt-page__act")
      .getByRole("button", { name: spanish ? "Más opciones" : "More options" })
      .click();
    await page.getByRole("menuitem", { name: spanish ? "Configuración" : "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: spanish ? "Configuración de Northwind Store" : "Northwind Store settings",
    });
    const savedAddress = settings.getByLabel(spanish ? "Dirección de la tienda" : "Store address", { exact: true });
    const replacement = settings.getByLabel(spanish ? "Contraseña de aplicación" : "Application password", {
      exact: true,
    });
    const save = settings.getByRole("button", { name: spanish ? "Guardar" : "Save", exact: true });
    await expect(replacement).toHaveValue("");
    await savedAddress.fill("https://shop.example.com/new-subfolder");
    await expect(save).toBeDisabled();
    await expect(replacement).toHaveAttribute("autocomplete", "new-password");
    await expect(settings).toContainText(
      spanish
        ? "Ingresá una credencial nueva para guardar este cambio."
        : "Enter a new credential to save this change.",
    );
    await replacement.fill("replacement-fixture-only");
    await expect(save).toBeEnabled();
  });
}
