// An agent asks for the isolated computer with a card, starts and stops it itself, and the owner turns the
// permission off from the agent's settings (DECISIONS.md#d-139).

import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { COMPUTER_GRANT } from "../../packages/protocol/src/environment-methods.ts";
import { expect, test } from "./kit.ts";

test("an agent asks for the computer, starts and stops it, and the owner takes the permission back", async ({
  page,
}) => {
  let running = false;
  const calls: string[] = [];
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {
      calls.push("start");
      running = true;
    },
    stop: async () => {
      calls.push("stop");
      running = false;
    },
    appearance: async () => {},
  });
  const llm = scriptedLlm((req) => {
    const done = req.messages.filter((m) => m.role === "tool").length;
    if (done === 0) return callTool("start", "computer", { action: "start" });
    if (done === 1) return callTool("stop", "computer", { action: "stop" });
    return say("Probé el sitio en Linux y apagué la computadora.");
  });
  let free = 12 * 1024 ** 3;
  const env = await startCore({
    llm,
    computer: {
      limaHome: "/unused",
      instance: "missing",
      lifecycle,
      executable: () => "/usr/bin/false",
      freeMemory: async () => free,
    },
  });
  try {
    await env.client.call("setup.finish", {});
    // The owner set the computer up once for the secretary, and shut it down.
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await expect.poll(async () => (await env.client.call("environments.status", {})).phase).toBe("running");
    await env.client.call("environments.stop", { thread: "home" });
    await expect.poll(async () => (await env.client.call("environments.status", {})).phase).toBe("stopped");

    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await page.getByRole("textbox", { name: /Escribile a/ }).fill("Probá el sitio en Linux");
    await page.keyboard.press("Enter");

    const card = page.locator(".inputcard.is-pending");
    await expect(card).toContainText("asks to use the isolated Linux computer");
    await expect(card.getByRole("button", { name: "Aceptar una vez", exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Aceptar siempre para este agente", exact: true }).click();
    await expect(page.getByText("Probé el sitio en Linux y apagué la computadora.")).toBeVisible();
    expect(calls).toEqual(["start", "stop", "start", "stop"]);
    const status = await env.client.call("environments.status", {});
    expect(status.thread).toBe(chat.id);
    expect(status.last_stop?.reason).toBe("agent");

    // The Computer panel says who shut it down; the agent's settings show the permission and take it back.
    await page.goto(`${env.core.url}/#thread=${chat.id}&panel=computer`);
    await expect(page.locator(".computer")).toContainText("El agente la apagó al terminar.");
    await expect(page.locator(".computer__badge")).toHaveText("Linux · 2 vCPU · 4 GiB");
    // Without room for it, the start is refused where the owner sees it, above the settings.
    free = 3 * 1024 ** 3;
    // The core's own refusal, passed on as a 200 so the browser does not log the expected 409 as an error.
    await page.route("**/rpc/environments.enable", async (route) => {
      const reply = await route.fetch();
      await route.fulfill({ status: 200, json: await reply.json() });
    });
    await page.getByRole("button", { name: "Encender VM", exact: true }).click();
    const refused = page.locator(".computer").getByRole("alert");
    await expect(refused).toContainText("not enough free memory on this computer: 3 GiB free");
    await expect(refused).toBeInViewport();
    await page.goto(`${env.core.url}/#project=~default&tab=team`);
    await page.locator(".teamcanvas__node", { hasText: "Scout" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Editar" }).click();
    const editor = page.getByRole("dialog", { name: /^Editar a/ });
    await editor.getByRole("button", { name: /^Computadora/ }).click();
    const allowed = editor.getByRole("switch", { name: "Computadora aislada" });
    await expect(allowed).toBeChecked();
    await allowed.click();
    await expect(allowed).not.toBeChecked();
    const grants = (await env.client.call("tools.approvals", {})).approvals;
    expect(grants.some((g) => g.key === COMPUTER_GRANT && g.agent_id === "scout")).toBe(false);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
