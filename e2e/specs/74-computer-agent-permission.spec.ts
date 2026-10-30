// An agent the owner allowed starts and stops the isolated computer itself, a start without room says so in the owner's
// language, and the owner turns the permission off from the agent's settings (DECISIONS.md#d-151, #d-154).

import type { Page } from "@playwright/test";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { COMPUTER_GRANT } from "../../packages/protocol/src/environment-methods.ts";
import { expect, test } from "./kit.ts";

/** A desktop that answers the viewer's handshake, so the panel can show a running screen. */
async function mockVmDisplay(page: Page) {
  await page.routeWebSocket(/\/vm-display\?/, (socket) => {
    let handshake = 0;
    socket.send(Buffer.from("RFB 003.008\n"));
    socket.onMessage(() => {
      if (handshake === 0) socket.send(Buffer.from([1, 1]));
      if (handshake === 1) socket.send(Buffer.from([0, 0, 0, 0]));
      if (handshake === 2) {
        const init = Buffer.alloc(27);
        init.writeUInt16BE(64, 0);
        init.writeUInt16BE(64, 2);
        init.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0], 4);
        init.writeUInt32BE(3, 20);
        init.write("APX", 24);
        socket.send(init);
      }
      handshake++;
    });
  });
}

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
    return say("Probé el sitio en Linux y dejé la computadora.");
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
    // Home stays on this machine (DECISIONS.md#d-154): Roby works on the computer in a chat of its own.
    const robyChat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Probar en Linux",
    });
    // The owner set the computer up once for the secretary, and shut it down.
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: robyChat.id, appearance: "light" });
    await expect.poll(async () => (await env.client.call("environments.status", {})).phase).toBe("running");
    await env.client.call("environments.stop", {});
    await expect.poll(async () => (await env.client.call("environments.status", {})).phase).toBe("stopped");

    // Only an agent the owner allowed is offered the computer (DECISIONS.md#d-154): they allow Scout first.
    await env.client.call("environments.permit", { agent: "scout", on: true });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await page.getByRole("textbox", { name: /Escribile a/ }).fill("Probá el sitio en Linux");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Probé el sitio en Linux y dejé la computadora.")).toBeVisible();
    expect(calls).toEqual(["start", "stop", "start"]);
    const status = await env.client.call("environments.status", { thread: chat.id });
    expect(status.phase).toBe("running");
    expect(status.chat).toMatchObject({ on: false, screen: 1 });

    // The panel shows Scout's own screen, free now, and offers to put the chat back on the computer.
    // A fresh load after mocking the viewer's socket: only pages loaded after it use the mock.
    await page.goto("about:blank");
    await mockVmDisplay(page);
    await page.goto(`${env.core.url}/#thread=${chat.id}&panel=computer`);
    const computer = page.locator(".computer");
    await expect(page.locator(".computer__badge")).toHaveText("Linux · 2 vCPU · 4 GiB");
    await expect(computer.getByRole("combobox", { name: "Pantalla" })).toHaveText(/Scout · :101/);
    await expect(computer.getByText("Scout trabaja en este equipo en este chat.")).toBeVisible();
    await expect(computer.getByRole("button", { name: "Usar la computadora acá", exact: true })).toBeVisible();
    await env.client.call("environments.stop", {});
    await expect(computer.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    // Without room for it, the start is refused where the owner sees it, above the settings, in their language.
    free = 5.5 * 1024 ** 3;
    // The core's own refusal, passed on as a 200 so the browser does not log the expected 409 as an error.
    await page.route("**/rpc/environments.enable", async (route) => {
      const reply = await route.fetch();
      await route.fulfill({ status: 200, json: await reply.json() });
    });
    await page.getByRole("button", { name: "Encender VM", exact: true }).click();
    const refused = page.locator(".computer").getByRole("alert");
    await expect(refused).toContainText(
      "No hay memoria libre suficiente en este equipo: 5,5 GiB libres, y la computadora necesita 4 GiB más 2 GiB",
    );
    await expect(refused).not.toContainText("not enough");
    await expect(refused).toBeInViewport();
    // Only the host reserve is missing: the owner may start it anyway.
    await expect(refused.getByRole("button", { name: "Encender igual", exact: true })).toBeVisible();
    // A smaller VM fits: one click lowers its memory and turns it on.
    await refused.getByRole("button", { name: "Bajarla a 3 GiB y encender", exact: true }).click();
    await expect.poll(async () => (await env.client.call("environments.status", {})).phase).toBe("running");
    expect((await env.client.call("environments.status", {})).resources?.memory_gib).toBe(3);
    await expect(page.locator(".computer").getByText(/memoria libre/)).toHaveCount(0);
    await env.client.call("environments.stop", {});
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
