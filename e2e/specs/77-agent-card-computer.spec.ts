// An agent's card says whether it may use the isolated computer and leads to where that is decided or watched, so the
// owner finds it without knowing the Computers view exists yet (DECISIONS.md#d-152).
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

test("an agent's card shows the computer off, turns it on in its settings, then leads to the Computers view", async ({
  page,
}) => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => false,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: {
      limaHome: "/unused",
      instance: "missing",
      lifecycle,
      executable: () => "/usr/bin/false",
      freeMemory: async () => 12 * 1024 ** 3,
    },
  });
  try {
    await env.client.call("setup.finish", {});
    await page.goto(`${env.core.url}/#project=~default&tab=team`);
    await page.getByRole("button", { name: /^Ver: Scout/ }).click();
    const detail = page.locator(".teamdetail");
    const row = detail.locator(".teamdetail__computer");
    await expect(row).toContainText("Apagada para este agente");
    // No agent may use it yet: the sidebar does not show the view, the card is the way in.
    const nav = page.getByRole("button", { name: "Computadoras", exact: true });
    await expect(nav).toHaveCount(0);
    await detail.getByRole("button", { name: /^Una computadora Linux/ }).hover();
    await expect(page.locator(".apx-tooltip")).toContainText("Una computadora Linux aparte de esta Mac");

    await row.getByRole("button", { name: "Activar", exact: true }).click();
    const editor = page.getByRole("dialog", { name: /^Editar a/ });
    const allowed = editor.getByRole("switch", { name: "Computadora aislada" });
    await expect(allowed).not.toBeChecked();
    await allowed.click();
    await expect(allowed).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    await expect(row).toContainText("Permitida (detenida)");
    await row.getByRole("button", { name: "Ver computadoras", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("La computadora está apagada");
    await expect(nav).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
