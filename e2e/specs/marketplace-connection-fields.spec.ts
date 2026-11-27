import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  test(`the extension's connection fields and help follow the panel language (${language})`, async ({ page }) => {
    const id = `northwind-${language}`;
    const { dir } = await world.info();
    const root = path.join(dir, id);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id,
        name: "Northwind Store",
        version: "1.0.0",
        settings: [
          {
            name: "site",
            type: "string",
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
    await page.getByRole("button", { name: connect, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `${connect} Northwind Store` });
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
  });
}
