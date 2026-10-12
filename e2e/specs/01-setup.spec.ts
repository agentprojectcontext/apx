// First run: a new install opens the setup by itself. Bringing v1 in, then the super-agent, engines, memory, the
// Telegram bot (emulated) and a project folder; then the setup again from the account menu, from scratch.
import { AGENT_NAMES } from "../../packages/protocol/src/constants.ts";
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
  // Provider management works before leaving the wizard, including correcting a saved key.
  await wizard.getByRole("button", { name: "Agregar proveedor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Acme wizard");
  await dialog.getByRole("textbox", { name: "URL base" }).fill("http://127.0.0.1:9/v1");
  await dialog.getByRole("textbox", { name: "Clave de API" }).fill("example-wizard-key-1234");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  const card = wizard.locator(".pcard").filter({ hasText: "Acme wizard" });
  await expect(card.getByText("****1234", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Editar", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Clave de API" }).fill("example-wizard-key-5678");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(card.getByText("****5678", { exact: true })).toBeVisible();
  await card.getByRole("switch", { name: "Activo", exact: true }).click();
  await expect(card.getByRole("switch")).not.toBeChecked();
  await card.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(card).toHaveCount(0);
  // A built-in one removed is gone too, not back as a suggestion of its kind.
  const anthropic = wizard.locator(".pcard").filter({ hasText: /^Anthropic/ });
  await anthropic.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(anthropic).toHaveCount(0);
  const ollama = wizard.locator(".pcard").filter({ hasText: /^Ollama/ });
  await ollama.getByRole("switch").click();
  await expect(wizard.locator(".chain__item")).toHaveCount(1);
  // A provider that gets ready brings its everyday model to the chain by itself.
  await ollama.getByRole("switch").click();
  await expect(wizard.locator(".chain__item")).toHaveCount(2);
  await expect(wizard.locator(".chain__item").last().getByRole("combobox")).toContainText("fake-1");
  await wizard.locator(".chain__item").last().getByRole("button", { name: "Subir", exact: true }).click();
  await expect(wizard.locator(".chain__item").first().getByRole("combobox")).toContainText("fake-1");
  await wizard.locator(".chain__item").first().getByRole("button", { name: "Bajar", exact: true }).click();

  await wizard.getByRole("button", { name: "Continuar" }).click();
  // Memory: by meaning, with v1's engine, and skills picked by meaning on.
  await expect(wizard.getByText("Motor de embeddings: Ollama · embeddinggemma:300m.")).toBeVisible();
  await expect(wizard.getByRole("button", { name: /Buscar por significado/ })).toHaveAttribute("aria-pressed", "true");
  await expect(wizard.getByRole("switch", { name: "Elegir skills por significado" })).toBeChecked();
  await wizard.getByRole("button", { name: "Continuar" }).click();

  // Channels: WhatsApp links from here too (it is linked in 10-whatsapp); the emulated Telegram bot.
  await expect(wizard.getByRole("button", { name: "Vincular" })).toBeVisible();
  const { token, repo } = await world.info();
  await wizard.getByRole("textbox", { name: "Token del bot", exact: true }).fill(token);
  const telegram = wizard.locator(".wiz__engine").filter({ hasText: "TELEGRAM" });
  await telegram.getByRole("button", { name: "Conectar" }).click();
  await expect(wizard.getByText("@apx_test_bot")).toBeVisible();
  // Discord and Slack connect from here too (their bot's token), with how to make the bot one click away.
  const discord = wizard.locator(".wiz__engine").filter({ hasText: "DISCORD" });
  await expect(discord.getByRole("textbox", { name: "Discord: Token del bot" })).toBeVisible();
  await discord.getByRole("button", { name: /Cómo crear el bot de Discord/ }).click();
  await expect(discord.locator(".wiz__howto li")).toHaveCount(4);
  await wizard.getByRole("button", { name: "Continuar" }).click();

  // A project with a folder.
  await wizard.getByRole("button", { name: /Elegir una carpeta/ }).click();
  await wizard.getByPlaceholder("/ruta/a/tu/proyecto").fill(repo);
  await wizard.getByRole("button", { name: "Crear crew" }).click();
  await expect(wizard.getByText(/está listo|is ready/)).toBeVisible();
  // With v1's `apx` here the owner first says whether `apx` becomes v2; then the app opens by itself.
  await expect(wizard.getByText("Abriendo tu chat con Robina…")).toBeHidden();
  await wizard.getByRole("button", { name: "Ahora no" }).click();
  await expect(wizard.getByText("Abriendo tu chat con Robina…")).toBeVisible();
  await expect(wizard).toBeHidden();
  await expect(page).toHaveURL(/thread=home/);
  // The super-agent greets first, in the language on screen, and its personality can be picked right there.
  await expect(page.getByText(/Soy Robina, tu super-agente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Directo y breve" })).toBeVisible();
  await page.getByRole("button", { name: "Otra", exact: true }).click();
  await page.getByRole("textbox", { name: /Contame cómo querés que sea/ }).fill("Con calma y paciencia");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Quiero que seas así: Con calma y paciencia.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Directo y breve" })).toBeHidden();
  const boss = await rpc<{ agent: { personality?: string } }>("agents.get", { agent: "roby" });
  expect(boss.agent.personality).toBe("Con calma y paciencia");

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
  const name = wizard.getByRole("textbox", { name: "Nombre" });
  await expect(name).toHaveValue("Robina");
  // The dice picks another of the names a fresh install picks from.
  await wizard.getByRole("button", { name: "Otro nombre" }).click();
  await expect(name).toHaveValue(new RegExp(`^(${AGENT_NAMES.join("|")})$`));
  await name.fill("Robina");
  for (let i = 0; i < 2; i++) await wizard.getByRole("button", { name: "Continuar" }).click();
  // Memory by meaning: no Ollama on this machine, so a link to get it, or the owner's own engine.
  await wizard.getByRole("button", { name: /Buscar por significado/ }).click();
  await expect(wizard.getByText(/Ollama no está corriendo en esta máquina/)).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Descargar Ollama" })).toBeVisible();
  await wizard.getByRole("button", { name: "Usar otro motor" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "URL base" })).toHaveValue(
    "http://127.0.0.1:11434",
  );
  await page.keyboard.press("Escape");
  await wizard.getByRole("button", { name: /Buscar por palabras/ }).click();
  for (let i = 0; i < 2; i++) await wizard.getByRole("button", { name: "Continuar" }).click();
  // The base project gets a name (it could stay Default) and a kind before any folder.
  const baseName = wizard.getByRole("textbox", { name: "Nombre del proyecto base" });
  await expect(baseName).toHaveValue("Default");
  await baseName.fill("Northwind");
  await wizard.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: /Empresa/ }).click();
  await wizard.getByRole("button", { name: /Usar la carpeta de APX/ }).click();
  await wizard.getByRole("button", { name: "Crear crew" }).click();
  await wizard.getByRole("button", { name: "Ahora no" }).click();
  await expect(wizard).toBeHidden();
  const { base } = await rpc<{ base: { name: string; kind?: string } }>("projects.list");
  expect(base).toEqual({ name: "Northwind", kind: "company" });
  // Back to how the other specs expect it.
  await rpc("projects.update_base", { name: "Default", kind: null });
});

test("right after the desktop app installs APX, the setup's welcome says so, once", async ({ page }) => {
  await page.goto("/?welcome=installed");
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
  const wizard = page.locator(".wiz");
  await expect(wizard.getByText("APX está instalado")).toBeVisible();
  await expect(wizard.getByText(/APX ya está instalado; ahora armamos tu crew/)).toBeVisible();
  // v1 is on this machine: the two ways in stay.
  await expect(wizard.getByRole("button", { name: /Importar desde APX v1/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("welcome")).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
  await expect(wizard.getByText("Open source")).toBeVisible();
  await expect(wizard.getByText("APX está instalado")).toBeHidden();
});

test("the setup's header picks the language, kept like the app's own", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
  const wizard = page.locator(".wiz");
  await wizard.getByRole("button", { name: "Idioma: Español" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(wizard.getByRole("button", { name: /Start from scratch/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: /setup/i }).click();
  await wizard.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("menuitem", { name: "Español" }).click();
  await expect(wizard.getByRole("button", { name: /Empezar de cero/ })).toBeVisible();
});

for (const look of ["minimal", "classic"]) {
  for (const mode of ["light", "dark"]) {
    test(`the wizard and its menus inherit ${look} ${mode}`, async ({ page }) => {
      await page.addInitScript(
        ({ look, mode }) => {
          localStorage.setItem("apx.prefs", JSON.stringify({ look, language: "es" }));
          localStorage.setItem("apx.mode", mode);
        },
        { look, mode },
      );
      await page.goto("/");
      await page.getByRole("button", { name: /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
      const wizard = page.locator(".wiz");
      await wizard.getByRole("button", { name: /Empezar de cero/ }).click();
      for (let i = 0; i < 4; i++) await wizard.getByRole("button", { name: "Continuar" }).click();
      await wizard.getByRole("combobox", { name: "Tipo" }).click();
      const popup = page.locator(".apx-select__popup");
      await expect(popup).toBeVisible();
      const theme = (element: Element) => {
        const root = element.closest("[data-apx-look]");
        return {
          look: root?.getAttribute("data-apx-look"),
          mode: root?.getAttribute("data-apx-mode"),
          surface: getComputedStyle(element).getPropertyValue("--apx-surface"),
        };
      };
      expect(await wizard.evaluate(theme)).toEqual(await popup.evaluate(theme));
      expect(await wizard.evaluate(theme)).toMatchObject({ look, mode });
    });
  }
}
