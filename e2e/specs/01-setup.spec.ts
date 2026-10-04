// First run: a new install opens the setup by itself. Bringing v1 in, then the super-agent, engines, memory, the
// Telegram bot (emulated) and a project folder; then the setup again from the account menu, from scratch.
import { expect, rpc, test, until, world } from "./kit.ts";

test("a new install opens the setup and imports APX v1", async ({ page }) => {
  await page.goto("/");
  const wizard = page.locator(".wiz");
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText("v1.120.0")).toBeVisible();

  await wizard.getByRole("button", { name: /Importar desde APX v1/ }).click();
  await expect(wizard.getByRole("switch").first()).toBeVisible();
  await expect(wizard.getByText("Ollama · embeddinggemma:300m")).toBeVisible();
  await expect(wizard.locator(".wiz__rowname").filter({ hasText: /^Motores\s*2$/ })).toBeVisible();
  await expect(wizard.locator(".wiz__rowname").filter({ hasText: /^Imágenes y voces\s*2$/ })).toBeVisible();
  await wizard.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/Importado:/)).toBeVisible();

  // The super-agent: its face and a new name.
  const name = wizard.getByRole("textbox", { name: "Nombre" });
  await name.fill("Robina");
  await wizard.getByRole("button", { name: "Continuar" }).click();

  // Engines: the fake model is already the chain's first, and each entry says which of its engine's models it is.
  await expect(wizard.getByText("custom/fake-1").first()).toBeVisible();
  // v1's fallback came in with its Ollama, keyless.
  await expect(wizard.getByText("ollama/gemma-e2e").first()).toBeVisible();
  await expect(wizard.getByRole("combobox", { name: "Modelo" }).first()).toBeVisible();
  await wizard.getByRole("button", { name: "Continuar" }).click();
  // Memory: by meaning, with v1's engine, and skills picked by meaning on.
  await expect(wizard.getByText("Motor de embeddings: Ollama · embeddinggemma:300m.")).toBeVisible();
  await expect(wizard.getByRole("button", { name: /Buscar por significado/ })).toHaveAttribute("aria-pressed", "true");
  await expect(wizard.getByRole("switch", { name: "Elegir skills por significado" })).toBeChecked();
  await wizard.getByRole("button", { name: "Continuar" }).click();

  // Channels: WhatsApp links from here too (it is linked in 10-whatsapp); the emulated Telegram bot.
  await expect(wizard.getByRole("button", { name: "Vincular" })).toBeVisible();
  const { token, repo } = await world.info();
  await wizard.getByRole("textbox", { name: "Token del bot" }).fill(token);
  await wizard.getByRole("button", { name: "Conectar" }).click();
  await expect(wizard.getByText("@apx_test_bot")).toBeVisible();
  await wizard.getByRole("button", { name: "Continuar" }).click();

  // A project with a folder.
  await wizard.getByRole("button", { name: /Con carpeta/ }).click();
  await wizard.getByPlaceholder("/ruta/a/tu/proyecto").fill(repo);
  await wizard.getByRole("button", { name: "Crear crew" }).click();
  await expect(wizard.getByText(/está listo|is ready/)).toBeVisible();
  await wizard.getByRole("button", { name: "Abrir APX" }).click();
  await expect(wizard).toBeHidden();

  // What came in.
  const projects = (await rpc<{ projects: Array<{ name: string }> }>("projects.list")).projects.map((p) => p.name);
  expect(projects).toEqual(
    expect.arrayContaining(["Northwind", "acme"].map((n) => expect.stringMatching(new RegExp(n, "i")))),
  );
  const agents = (await rpc<{ agents: Array<{ name: string; kind: string }> }>("agents.list")).agents;
  expect(agents.find((a) => a.kind === "secretary")?.name).toBe("Robina");
  const channels = (await rpc<{ channels: Array<{ status: string }> }>("channels.list")).channels;
  await until(
    async () => (await rpc<{ channels: Array<{ status: string }> }>("channels.list")).channels[0]?.status === "running",
  );
  expect(channels.length).toBe(1);
  // v1's image server and voice, kept in v2's settings.
  const services = (await rpc<{ services: Array<{ id: string; kind: string }> }>("services.list")).services;
  expect(services.map((s) => `${s.kind}:${s.id}`)).toEqual(expect.arrayContaining(["image:homelab", "speech:qvox"]));
  expect((await rpc<{ done: boolean }>("setup.status")).done).toBe(true);
  await expect(page.getByRole("button", { name: /Northwind/ })).toBeVisible();
});

test("the setup opens again from the account menu and starts from scratch", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wiz")).toBeHidden();
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
  const wizard = page.locator(".wiz");
  await wizard.getByRole("button", { name: /Empezar de cero/ }).click();
  await expect(wizard.getByRole("textbox", { name: "Nombre" })).toHaveValue("Robina");
  for (let i = 0; i < 4; i++) await wizard.getByRole("button", { name: "Continuar" }).click();
  await wizard.getByRole("button", { name: /Por ahora no/ }).click();
  await wizard.getByRole("button", { name: "Crear crew" }).click();
  await wizard.getByRole("button", { name: "Abrir APX" }).click();
  await expect(wizard).toBeHidden();
});
