// Asked to use the computer, the agent starts it and says once that it will let the owner know; the chat shows how far
// the computer got, and the agent carries on by itself the moment it is up (DECISIONS.md#d-151).
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

test("the chat shows the computer being created, then ready, and the agent carries on without the owner", async ({
  page,
}) => {
  let installed = false;
  let running = false;
  let boot = () => {};
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => installed,
    running: async () => running,
    prepare: async () => {
      await new Promise<void>((resolve) => (boot = resolve));
      installed = true;
      running = true;
    },
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
  });
  const llm = scriptedLlm((req, { said }) => {
    if (said.includes("is ready")) return say("Lista la computadora, sigo con la tienda.");
    const done = req.messages.filter((m) => m.role === "tool").length;
    return done ? say("Ahora te aviso.") : callTool("start", "computer", { action: "start" });
  });
  const env = await startCore({
    llm,
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
    // Home stays on this Mac (DECISIONS.md#d-154): Roby works on the computer in a chat of its own.
    const robyChat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Probar en Linux",
    });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await page.goto(`${env.core.url}/#thread=${robyChat.id}`);
    await page.getByRole("textbox", { name: /Escribile a/ }).fill("Probá la tienda en la computadora");
    await page.keyboard.press("Enter");

    const chip = page.locator(".chat__computer");
    await expect(chip).toHaveText("Creando máquina virtual");
    await expect(page.getByText("Ahora te aviso.")).toBeVisible();
    boot();
    await expect(chip).toHaveText("Lista");
    await expect(page.getByText("Lista la computadora, sigo con la tienda.")).toBeVisible();
    await expect(chip).toHaveCount(0, { timeout: 10_000 });
  } finally {
    boot();
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
