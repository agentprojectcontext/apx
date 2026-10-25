// The Computers view: every agent screen in use as a wall of view-only tiles; one opens large with its lease and its
// chat (DECISIONS.md#d-152).
import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

/** A desktop that answers the viewer's handshake; it must be routed before the page loads. */
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

test("the Computers view shows two screens in use as two tiles, and opens one large with its chat", async ({
  page,
}) => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const ends: Array<() => void> = [];
  const llm = scriptedLlm(async (req) => {
    await new Promise<void>((resolve) => {
      ends.push(resolve);
      req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say("Listo");
  });
  const env = await startCore({
    llm,
    computer: { limaHome: "/unused", instance: "missing", lifecycle, executable: () => "/usr/bin/false" },
  });
  try {
    await env.client.call("setup.finish", {});
    const chats: Record<string, string> = {};
    for (const [agent, title] of [
      ["roby", "Probar la tienda"],
      ["scout", "Revisar el sitio de Acme"],
    ] as const) {
      await env.client.call("environments.permit", { agent, on: true });
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: agent, title });
      await env.client.call("environments.bind", { thread: chat.id });
      chats[agent] = chat.id;
    }
    await env.client.call("environments.status", {});
    await page.setViewportSize({ width: 1600, height: 1000 });
    await mockVmDisplay(page);
    await page.goto(`${env.core.url}/#view=computers`);
    const wall = page.locator(".computers");
    await expect(page.getByRole("button", { name: /^Computadoras/ })).toBeVisible();
    await expect(wall.getByText("Ningún agente está usando la computadora")).toBeVisible();

    for (const agent of ["roby", "scout"])
      await env.client.call("threads.send", { thread: chats[agent] ?? "", text: "Trabajá en la computadora" });
    const tiles = wall.locator(".computers__tile");
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(0)).toContainText("Roby");
    await expect(tiles.nth(0)).toContainText("Probar la tienda");
    await expect(tiles.nth(1)).toContainText("Scout");
    await expect(tiles.nth(1)).toContainText("Agente trabajando");
    await expect(wall.getByText("2 de 2 pantallas de agentes en uso.", { exact: false })).toBeVisible();

    await wall.getByRole("button", { name: "Abrir la pantalla de Scout", exact: true }).click();
    await expect(tiles).toHaveCount(0);
    await expect(wall.locator(".computers__large")).toContainText("Revisar el sitio de Acme");
    await wall.getByRole("button", { name: "Tomar control", exact: true }).click();
    await expect(wall.getByRole("button", { name: "Devolver control al agente", exact: true })).toBeVisible();
    await expect(wall.locator(".computers__large")).toContainText("Tenés el control");
    await wall.getByRole("button", { name: "Abrir chat", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${chats.scout}`));
  } finally {
    for (const end of ends) end();
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});

test("a screen kept up after its run shows on the wall as idle, opens large with its chat, and another chat points to it", async ({
  page,
}) => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("Listo")),
    computer: { limaHome: "/unused", instance: "missing", lifecycle, executable: () => "/usr/bin/false" },
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("environments.permit", { agent: "roby", on: true });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Lint del repo" });
    await env.client.call("environments.bind", { thread: chat.id });
    await env.client.call("threads.send", { thread: chat.id, text: "Corré el lint" });
    await env.settle(chat.id);
    // The run is over; Roby's screen stays up.
    const status = await env.client.call("environments.status", {});
    expect(status.screens?.map((s) => [s.screen, Boolean(s.run)])).toEqual([[1, false]]);

    await page.setViewportSize({ width: 1600, height: 1000 });
    await mockVmDisplay(page);
    await page.goto(`${env.core.url}/#view=computers`);
    const wall = page.locator(".computers");
    await expect(wall.getByText("1 de 2 pantallas de agentes en uso.", { exact: false })).toBeVisible();
    const tile = wall.locator(".computers__tile");
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText("Roby");
    await expect(tile).toContainText("Lint del repo");
    await expect(tile).toContainText("En espera");
    await expect(wall.getByText("Ningún agente está usando la computadora")).toHaveCount(0);
    await wall.getByRole("button", { name: "Abrir la pantalla de Roby", exact: true }).click();
    await wall.getByRole("button", { name: "Abrir chat", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${chat.id}`));

    // In another chat of Roby's, on this Mac: its screen is that chat's, one click away.
    await page.goto(`${env.core.url}/#thread=home&panel=computer`);
    const computer = page.locator(".computer");
    await expect(
      computer.getByText("Este chat corre en esta Mac. La pantalla de Roby en la computadora es de su otro chat."),
    ).toBeVisible();
    await expect(computer.getByRole("button", { name: "Usar la computadora acá", exact: true })).toBeVisible();
    await computer.getByRole("button", { name: "Abrir ese chat", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${chat.id}`));
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
