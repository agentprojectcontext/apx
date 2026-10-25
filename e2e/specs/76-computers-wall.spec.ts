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
    // Both allowed agents have a tile before any run: off, with the way to turn them on.
    await expect(wall.locator(".computers__tile.is-off")).toHaveCount(2);
    await expect(wall.getByText("Pantalla apagada")).toHaveCount(2);

    for (const agent of ["roby", "scout"])
      await env.client.call("threads.send", { thread: chats[agent] ?? "", text: "Trabajá en la computadora" });
    const tiles = wall.locator(".computers__tile");
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(0)).toContainText("Roby");
    await expect(tiles.nth(0)).toContainText("Probar la tienda");
    await expect(tiles.nth(1)).toContainText("Scout");
    await expect(tiles.nth(1)).toContainText("Agente trabajando");
    await expect(wall.getByText("2 de 2 pantallas en uso", { exact: false })).toBeVisible();

    await wall.getByRole("button", { name: "Abrir la pantalla de Scout", exact: true }).click();
    await expect(tiles).toHaveCount(0);
    await expect(wall.locator(".computers__large")).toContainText("Revisar el sitio de Acme");
    // One toolbar holds everything; the wall's bar is gone and the chat opens beside the desktop.
    const bar = wall.locator(".computer__controlbar");
    await expect(wall.locator(".computers__bar")).toHaveCount(0);
    await expect(bar).toContainText("Todas las pantallas");
    await expect(bar).toContainText("Scout");
    await expect(bar).toContainText("Agente trabajando");
    await expect(bar.getByRole("button", { name: "Tomar control", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Más", exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Chat", exact: true }).click();
    const side = wall.locator(".computers__chat");
    await expect(side).toContainText("Trabajá en la computadora");
    await expect(side.getByRole("textbox")).toBeVisible();
    await side.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(side).toHaveCount(0);
    await wall.getByRole("button", { name: "Tomar control", exact: true }).click();
    await expect(wall.getByRole("button", { name: "Devolver control al agente", exact: true })).toBeVisible();
    await expect(wall.locator(".computers__large")).toContainText("Tenés el control");
    await wall.getByRole("button", { name: "Chat", exact: true }).click();
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
    await expect(wall.getByText("1 de 2 pantallas en uso", { exact: false })).toBeVisible();
    const tile = wall.locator(".computers__tile");
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText("Roby");
    await expect(tile.getByRole("button", { name: "Apagar pantalla", exact: true })).toBeVisible();
    await expect(tile).toContainText("Lint del repo");
    await expect(tile).toContainText("En espera");
    await wall.getByRole("button", { name: "Abrir la pantalla de Roby", exact: true }).click();
    await wall.getByRole("button", { name: "Chat", exact: true }).click();
    await wall.getByRole("button", { name: "Abrir chat", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${chat.id}`));

    // In another chat of Roby's, on this Mac: its screen is that chat's, one click away.
    const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Otro chat" });
    await page.goto(`${env.core.url}/#thread=${other.id}&panel=computer`);
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

test("the wall shows an off tile per allowed agent, turns one on, and says when the memory has no room for another", async ({
  page,
}) => {
  const running = true;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
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
    for (const agent of ["roby", "scout", "vera"]) await env.client.call("environments.permit", { agent, on: true });
    await env.client.call("environments.status", {});
    await page.setViewportSize({ width: 1600, height: 1000 });
    await mockVmDisplay(page);
    // The core's own refusal, passed on as a 200 so the browser does not log the expected 409 as an error.
    await page.route("**/rpc/environments.screen", async (route) => {
      const reply = await route.fetch();
      await route.fulfill({ status: 200, json: await reply.json() });
    });
    await page.goto(`${env.core.url}/#view=computers`);
    const wall = page.locator(".computers");
    const off = wall.locator(".computers__tile.is-off");
    await expect(off).toHaveCount(3);
    await expect(wall.getByRole("heading")).toHaveCount(0);

    await off.filter({ hasText: "Roby" }).getByRole("button", { name: "Encender pantalla", exact: true }).click();
    await expect(wall.locator(".computers__tile:not(.is-off)")).toHaveCount(1);
    await expect(wall.locator(".computers__tile:not(.is-off)")).toContainText("Roby");
    await expect(off).toHaveCount(2);

    await off.filter({ hasText: "Scout" }).getByRole("button", { name: "Encender pantalla", exact: true }).click();
    await expect(wall.locator(".computers__tile:not(.is-off)")).toHaveCount(2);

    // The memory holds two screens: a third is refused, with the names that fill it.
    await off.getByRole("button", { name: "Encender pantalla", exact: true }).click();
    await expect(off).toHaveCount(1);
    await expect(off.getByRole("alert")).toContainText("No hay lugar para otra pantalla");
    await expect(off.getByRole("alert")).toContainText("Roby");

    await wall
      .locator(".computers__tile:not(.is-off)")
      .first()
      .getByRole("button", { name: "Apagar pantalla", exact: true })
      .click();
    await expect(off).toHaveCount(2);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});

test("with the computer off the view shows only the global state", async ({ page }) => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => false,
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
    await page.goto(`${env.core.url}/#view=computers`);
    const wall = page.locator(".computers");
    await expect(wall.getByText("La computadora está apagada")).toBeVisible();
    await expect(wall.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    await expect(wall.locator(".computers__tile")).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
