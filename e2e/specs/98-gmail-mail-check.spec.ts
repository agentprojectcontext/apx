import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("Gmail's settings turn the mail check on, choose how often, and bring the signature Gmail keeps", async ({
  page,
}) => {
  await rpc("setup.finish");
  const catalog = await rpc<Result<"integrations.list">>("integrations.list");
  await page.route("**/rpc/integrations.list", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          integrations: catalog.integrations.map((i) =>
            i.id === "gmail"
              ? {
                  ...i,
                  connected: true,
                  oauth: { ...i.oauth, account: "user@example.com", client: "own" },
                }
              : { ...i, connected: false },
          ),
        },
      },
    });
  });
  // Gmail itself is not reachable here: its answer is what Gmail's signature turns into.
  await page.route("**/rpc/email.signature_import", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          text: "Alex Rivera\nAcme",
          html: '<div><b>Alex Rivera</b></div><div><a href="https://example.com">Acme</a></div>',
        },
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page.getByRole("button", { name: "Configurar integración", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Configurar integración", exact: true });

  const every = settings.getByRole("spinbutton", { name: "Cada cuánto revisar" });
  await expect(every).toHaveValue("5");
  await expect(every).toBeDisabled();
  await settings.getByRole("switch", { name: "Avisarme de los mails nuevos" }).click();
  await expect(every).toBeEnabled();
  await every.fill("2");
  await settings.getByRole("combobox", { name: "Cada cuánto revisar: unidad", exact: true }).click();
  await page.getByRole("option", { name: "Horas" }).click();
  await settings.getByRole("switch", { name: "Solo los importantes" }).click();
  await expect
    .poll(async () => (await rpc<Result<"integrations.settings">>("integrations.settings", { id: "gmail" })).mail)
    .toEqual({ enabled: true, every_min: 120, important_only: true });

  await settings.getByRole("button", { name: "Traer de Gmail", exact: true }).click();
  await expect(settings.getByLabel("Firma HTML (opcional)", { exact: true })).toHaveValue(
    '<div><b>Alex Rivera</b></div><div><a href="https://example.com">Acme</a></div>',
  );
  await expect(settings.getByTitle("Vista previa de la firma")).toBeVisible();
  await settings.getByRole("radio", { name: "Texto plano", exact: true }).click();
  await expect(settings.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("Alex Rivera\nAcme");
  await rpc("integrations.configure", { id: "gmail", mail: { enabled: false, every_min: 5, important_only: false } });
});
