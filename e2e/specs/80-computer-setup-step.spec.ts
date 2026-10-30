// A host that still lacks something the computer needs (QEMU on Linux, WSL on Windows) shows it as one step in the
// owner's language, with the command to copy and a retry, instead of the raw reason (DECISIONS.md#d-183).
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import type { ComputerNeed } from "../../apps/core/src/environments/host.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

test("a missing QEMU shows as a step with its command, and the step goes once the host has it", async ({ page }) => {
  let need: ComputerNeed | undefined = {
    reason: "qemu",
    command: "sudo apt install qemu-system-x86 qemu-utils",
    message: "Computer needs QEMU on this Linux host",
  };
  let starts = 0;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => false,
    running: async () => false,
    prepare: async () => {
      starts++;
      if (need) throw new Error(need.message);
    },
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
      needs: () => need,
    },
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("environments.permit", { agent: "scout", on: true });
    await page.goto(`${env.core.url}/#view=computers`);
    const step = page.locator(".computer__needs");
    await expect(step).toContainText("Falta un paso en este equipo");
    await expect(step).toContainText("La computadora arma su máquina Linux con QEMU");
    await expect(step.locator("code")).toHaveText("sudo apt install qemu-system-x86 qemu-utils");
    await expect(step.getByRole("button", { name: "Copiar" })).toBeVisible();
    // The raw reason the core gives agents never reaches the screen.
    await expect(page.getByText("Computer needs QEMU")).toHaveCount(0);

    // With the step there, its retry is the only way to start: no second start button beside it.
    await expect(page.getByRole("button", { name: "Encender VM" })).toHaveCount(0);

    // A chat's computer panel shows the same step, in place of its setup button.
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout", title: "Probar" });
    await page.goto(`${env.core.url}/#thread=${chat.id}&panel=computer`);
    const panel = page.locator(".computer");
    await expect(panel.locator(".computer__needs code")).toHaveText("sudo apt install qemu-system-x86 qemu-utils");
    await expect(panel.getByRole("button", { name: /^(Activar computadora|Reintentar preparación)$/ })).toHaveCount(0);

    // Installed: the retry starts the computer and the step is gone.
    need = undefined;
    await panel.getByRole("button", { name: "Listo, probar de nuevo" }).click();
    await expect(panel.locator(".computer__needs")).toHaveCount(0);
    await expect.poll(() => starts).toBeGreaterThan(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
