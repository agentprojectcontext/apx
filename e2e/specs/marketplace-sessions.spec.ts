import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

const bridge = path.resolve("apps/core/src/extensions/session-bridge.test-support.mjs");

for (const [language, width] of [
  ["es", 1280],
  ["es", 390],
  ["en", 1280],
  ["en", 390],
] as const) {
  test(`the connection card separates disconnect, pause and removal (${language}, ${width})`, async ({
    page,
  }, info) => {
    const es = language === "es";
    const name = width === 1280 ? "Tiendanube" : "Figma";
    const id = `${name.toLowerCase()}_demo_${language}`;
    const { dir } = await world.info();
    const root = path.join(dir, id);
    const shim = path.join(dir, "bin", "mcp-remote");
    if (!fs.existsSync(shim)) fs.symlinkSync(process.execPath, shim);
    const callbackFile = path.join(root, "callback.txt");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id,
        name,
        version: "1.0.0",
        description: es
          ? "Trabajá desde APX con los permisos que elegís."
          : "Use this service from APX with the permissions you choose.",
        mcp: {
          service: {
            command: "mcp-remote",
            args: [bridge],
            env: { FIXTURE_CALLBACK_FILE: callbackFile },
          },
        },
      }),
    );
    const tienda = name === "Tiendanube";
    fs.writeFileSync(
      path.join(root, "apx-listing.json"),
      JSON.stringify({
        schema: 2,
        id,
        connection: "oauth",
        tagline: tienda ? "Connect your store to APX" : "Bring your Figma files into your work in APX",
        description: tienda
          ? "Review which tools are available for your store before asking APX to make any changes."
          : "Ask APX to summarize design decisions from files your account can access.",
        prompts: [tienda ? "Tell me what you can do in my store." : "Summarize the notes on this design."],
        locales: {
          es: {
            tagline: tienda ? "Conectá tu tienda con APX" : "Usá tus archivos de Figma en APX",
            description: tienda
              ? "Revisá qué herramientas hay disponibles para tu tienda antes de pedirle a APX que haga cambios."
              : "Pedile a APX que resuma las decisiones de diseño de los archivos a los que tenés acceso.",
            prompts: [tienda ? "Contame qué podés hacer en mi tienda." : "Resumí las notas de este diseño."],
          },
        },
      }),
    );
    const setup = await rpc<Record<string, unknown>>("setup.status");
    await page.route("**/rpc/setup.status", (route) =>
      route.fulfill({ json: { ok: true, result: { ...setup, done: true } } }),
    );
    await rpc("extensions.install", { path: root });
    await page.setViewportSize({ width, height: width > 400 ? 820 : 844 });
    await page.addInitScript((language) => {
      const prefs = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
      localStorage.setItem("apx.prefs", JSON.stringify({ ...prefs, language }));
    }, language);
    await open(page, `#view=marketplace&item=ext%3A${id}`);
    const card = page.getByRole("region", { name: es ? "Conexión" : "Connection", exact: true });
    const disconnect = es ? "Desconectar" : "Disconnect";
    const action = card.getByRole("button", { name: disconnect, exact: true });
    const confirm = () => page.getByRole("dialog", { name: es ? `¿Desconectar ${name}?` : `Disconnect ${name}?` });
    const more = card.getByRole("button", { name: es ? "Más opciones" : "More options" });
    const shot = async (state: string) => {
      if (process.env.APX_MARKETPLACE_SHOTS)
        await page.screenshot({
          path: path.join(process.env.APX_MARKETPLACE_SHOTS, `${language}-${width}-${state}.png`),
          animations: "disabled",
        });
    };
    await expect(action).toHaveCount(0);
    await rpc("extensions.enable", { id, enabled: true });
    await expect(card).toContainText(es ? "Sin conectar" : "Not connected");
    await shot("disconnected");
    await rpc("mcp.signIn", { scope: "global", server: `${id}-service` });
    await expect.poll(() => fs.existsSync(callbackFile)).toBe(true);
    expect((await fetch(fs.readFileSync(callbackFile, "utf8"))).ok).toBe(true);
    await expect
      .poll(
        async () =>
          (await rpc<{ servers: { name: string; status: string }[] }>("mcp.list")).servers.find(
            (s) => s.name === `${id}-service`,
          )?.status,
      )
      .toBe("ready");
    await page.reload();
    await expect(card).toContainText(es ? "Conectada" : "Connected");
    await expect(action).toBeVisible();
    await shot("connected");

    await more.click();
    await page.getByRole("menuitem", { name: es ? "Configuración" : "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: es ? `Configuración de ${name}` : `${name} settings` });
    await expect(settings).not.toContainText(/No tiene nada para configurar|Nothing to set up/);
    await expect(settings.getByText(es ? "Opciones avanzadas" : "Advanced options")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    await more.click();
    await page.getByRole("menuitem", { name: es ? "Apagar" : "Turn off", exact: true }).click();
    const pause = page.getByRole("dialog", { name: es ? `¿Apagar ${name}?` : `Turn off ${name}?` });
    await expect(pause).toContainText(es ? "conservar el inicio de sesión" : "keep your sign-in");
    await pause.getByRole("button", { name: es ? "Apagar" : "Turn off", exact: true }).click();
    await expect(card).toContainText(es ? "Apagada" : "Off");
    await shot("off");

    let fail = true;
    const route = async (route: import("@playwright/test").Route) => {
      if (!fail) return route.continue();
      await route.fulfill({ json: { ok: false, error: { code: "conflict", message: "fixture failure" } } });
    };
    await page.route("**/rpc/extensions.disconnect", route);
    const offAction = async () => {
      await more.click();
      await page.getByRole("menuitem", { name: disconnect, exact: true }).click();
      await expect(confirm()).toContainText(es ? "seguir instalada" : "stay installed");
      await confirm().getByRole("button", { name: disconnect, exact: true }).click();
    };
    await offAction();
    await expect(card).toContainText(es ? "APX no pudo desconectarla" : "APX couldn’t disconnect it");
    await shot("error");
    fail = false;
    await card.getByRole("button", { name: es ? "Probar de nuevo" : "Try again", exact: true }).click();
    await confirm().getByRole("button", { name: disconnect, exact: true }).click();
    await expect(card).not.toContainText(es ? "APX no pudo desconectarla" : "APX couldn’t disconnect it");
    await expect
      .poll(
        async () =>
          (await rpc<{ extensions: { id: string; enabled: boolean }[] }>("extensions.list")).extensions.find(
            (e) => e.id === id,
          )?.enabled,
      )
      .toBe(false);
    await more.click();
    await expect(page.getByRole("menuitem", { name: disconnect, exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: es ? "Quitar" : "Remove", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const connect = es ? "Conectar" : "Connect";
    fs.rmSync(callbackFile);
    await card.getByRole("button", { name: connect, exact: true }).click();
    const box = page.getByRole("dialog");
    await box.getByRole("button", { name: connect, exact: true }).click();
    await expect.poll(() => fs.existsSync(callbackFile)).toBe(true);
    await expect(box.locator('a[href^="https://shop.example.com/authorize"]')).toBeVisible();
    expect((await fetch(fs.readFileSync(callbackFile, "utf8"))).ok).toBe(true);
    await box.getByRole("button", { name: es ? "Listo" : "Done", exact: true }).click();
    await expect(action).toBeVisible();
    await info.attach("connection-final", { body: await page.screenshot(), contentType: "image/png" });
  });
}
