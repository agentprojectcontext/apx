// An agent sends the owner to a place in the app with a link: the chat shows it as a button that goes there, and a
// link to a place the app does not have stays its label.
import net, { type AddressInfo } from "node:net";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("un enlace del agente a Config › Escritorio es un botón que abre esa sección", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm(() =>
    say("Está apagado: lo prendés en [Config › Escritorio](apx:settings/desktop). [Otro lado](apx:nowhere) no existe."),
  );
  const env = await startCore({ port, llm });
  try {
    await env.client.call("setup.finish", {});
    await page.goto(env.core.url);
    await page.getByRole("textbox", { name: /^Escribile a/ }).fill("usá mi compu");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const go = page.getByRole("button", { name: "Config › Escritorio", exact: true });
    await expect(go).toBeVisible();
    // An unknown place is plain text, never a link that goes nowhere.
    await expect(page.locator(".transcript").getByText("Otro lado", { exact: false })).toBeVisible();
    await expect(page.locator(".transcript").getByRole("button", { name: "Otro lado" })).toHaveCount(0);
    await expect(page.locator(".transcript").getByRole("link", { name: "Otro lado" })).toHaveCount(0);
    await go.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Escritorio", exact: true })).toBeVisible();
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
