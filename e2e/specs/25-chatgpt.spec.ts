// Engines and models: the owner's plans first (Codex, signed in from APX; Claude's plan only in Claude Code), then the
// model APIs, known ones shown even before they are set up. The CLIs live in External sessions, never in a picker of
// models for agents.
import { expect, open, rpc, test } from "./kit.ts";

test("the plans come first: Codex connects with its own sign-in, Claude's plan points to Claude Code", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const status = await rpc<{ connected: boolean }>("chatgpt.status");
  expect(status.connected).toBe(false);
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
  await box.fill("motores y modelos");
  await page.getByRole("option", { name: /Motores y modelos/ }).click();
  const settings = page.getByRole("dialog", { name: "Configuración" });

  // No CLI card here and nothing to put a CLI in the router.
  await expect(settings.getByRole("button", { name: "Usarlo en el router" })).toHaveCount(0);
  const codex = settings.locator(".plan", { hasText: "Codex" });
  await expect(codex).toContainText("Plan de ChatGPT");
  await expect(codex).toContainText("Sin conectar");
  await expect(settings.locator(".plan", { hasText: "Claude" })).toContainText("Solo en Claude Code");

  // ChatGPT's setting comes first: the sign-in waits until the owner says it is on.
  await codex.getByRole("button", { name: "Conectar" }).click();
  const signIn = page.getByRole("dialog", { name: "Conectar Codex" });
  await expect(signIn).toContainText("separado del de la app de Codex");
  await expect(signIn.getByRole("link", { name: /Abrir la seguridad de ChatGPT/ })).toHaveAttribute(
    "href",
    "https://chatgpt.com/#settings/Security",
  );
  const start = signIn.getByRole("button", { name: "Iniciar sesión con ChatGPT" });
  await expect(start).toBeDisabled();
  await signIn.getByText("Ya la activé").click();
  await expect(start).toBeEnabled();
  await signIn.getByRole("button", { name: "Cancelar" }).click();

  // A known model API not set up yet has its card, named with a capital, and opens already filled in.
  const groq = settings.locator(".pcard.is-unset", { hasText: "Groq" });
  await expect(groq).toContainText("Sin configurar");
  await groq.getByRole("button", { name: "Configurar" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor" });
  await expect(dialog.getByRole("textbox", { name: "URL base" })).toHaveValue("https://api.groq.com/openai/v1");
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  // The CLIs are in External sessions.
  await settings.getByRole("button", { name: "Sesiones externas", exact: true }).click();
  await expect(settings.locator(".engine", { hasText: "Claude Code" })).toBeVisible();
});

test("a CLI is never offered as a model for agents or the router, and the core refuses one", async ({ page }) => {
  await expect(
    rpc("agents.update", { agent: "roby", model_choice: { model: "claude", router: false } }),
  ).rejects.toThrow(/own sessions/);
  await open(page);
  await page.getByRole("button", { name: "Config", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await settings.getByRole("button", { name: "Router" }).click();
  await settings.getByRole("button", { name: "Agregar un modelo" }).click();
  const list = page.getByRole("listbox", { name: "Modelos" });
  await expect(list).toContainText("fake-1");
  await expect(list).not.toContainText("Claude Code");
});
