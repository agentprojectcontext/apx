import path from "node:path";
import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { expect, test } from "./kit.ts";

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

test("Computer installs only on enable, shows the chat agent's screen, follows APX appearance and stops for everyone", async ({
  page,
}) => {
  let installed = false;
  let running = false;
  const calls: string[] = [];
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => installed,
    running: async () => running,
    prepare: async (mode) => {
      calls.push(`prepare:${mode}`);
      installed = true;
      running = true;
    },
    stop: async () => {
      calls.push("stop");
      running = false;
    },
    appearance: async () => {},
  });
  // Roby's turn holds its screen until the test lets it end.
  let finish: () => void = () => {};
  const llm = scriptedLlm(async (req) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
      req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say("ok");
  });
  const home = tempDir("apx-computer-ui-").path;
  const env = await startCore({
    home,
    llm,
    computer: {
      limaHome: path.join(home, "no-vms"),
      instance: "missing",
      lifecycle,
      executable: () => "/usr/bin/false",
      screens: {
        start: async (n, mode) => {
          calls.push(`screen ${n}:${mode}`);
        },
        stop: async () => {},
        appearance: async (n, mode) => {
          calls.push(`appearance ${n}:${mode}`);
        },
      },
    },
  });
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await mockVmDisplay(page);
    await env.client.call("setup.finish", {});
    // Home stays on this Mac (DECISIONS.md#d-154): Roby works on the computer in a chat of its own.
    const robyChat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Probar en Linux",
    });
    await page.addInitScript((origin) => {
      if (location.origin === origin) localStorage.setItem("apx.mode", "light");
    }, env.core.url);
    await page.goto(`${env.core.url}/#thread=${robyChat.id}&panel=computer`);
    const computer = page.locator(".computer");
    // Off for every agent: turning it on for this chat first allows its agent.
    const allow = computer.getByRole("button", { name: "Permitir a Roby y activar", exact: true });
    await expect(allow).toBeVisible();
    await expect(computer.getByRole("combobox", { name: "Memoria" })).toHaveText(/4 GiB/);
    expect(calls).toEqual([]);
    await allow.click();
    await expect(computer.getByRole("button", { name: "Apagar para todos", exact: true })).toBeVisible();
    expect(calls).toContain("prepare:light");
    // No agent holds a screen yet: there is no owner screen, only a note about Roby's.
    await expect(computer.getByText("La pantalla de Roby no está encendida.", { exact: false })).toBeVisible();
    await expect(computer.getByText("0 de 2 pantallas de agentes en uso")).toBeVisible();
    // Roby works on the computer: the panel shows its screen, in its hands until the owner takes it.
    await env.client.call("threads.send", { thread: robyChat.id, text: "Work on the computer" });
    await expect(computer.getByRole("combobox", { name: "Pantalla" })).toHaveText(/Roby · :101 · trabajando/);
    expect(calls).toContain("screen 1:light");
    await expect(computer.locator(".computer__locked")).toBeVisible();
    await expect(computer.locator(".computer__notice")).toHaveCount(0);
    await computer.getByRole("button", { name: "Tomar control", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Devolver control al agente", exact: true })).toBeVisible();
    await expect(computer.locator(".computer__locked")).toHaveCount(0);
    const editor = computer.getByRole("textbox", { name: "Comando dentro de la VM" });
    // Said plainly whose user and folder the commands run in, and that control comes first.
    await expect(computer.getByRole("log")).toContainText(
      "Los comandos que mandes acá corren con el usuario Linux de Roby, en ~/work. Primero tomá el control",
    );
    // A one-line command box, growing only for a longer command.
    const boxHeight = () => editor.evaluate((element) => element.getBoundingClientRect().height);
    const oneLine = await boxHeight();
    expect(oneLine).toBeLessThan(40);
    await editor.fill("printf 'first\nsecond'\npwd");
    expect(await boxHeight()).toBeGreaterThan(oneLine);
    await editor.press("End");
    await editor.press("Backspace");
    await expect(editor).toHaveValue("printf 'first\nsecond'\npw");
    const consolePanel = computer.locator(".computer__console");
    const before = await consolePanel.evaluate((element) => element.getBoundingClientRect().height);
    const handle = computer.getByRole("separator", { name: "Redimensionar terminal" });
    const grip = await handle.boundingBox();
    if (!grip) throw new Error("Missing terminal resize grip");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 70, { steps: 5 });
    await page.mouse.up();
    expect(await consolePanel.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(before);
    // Dragged all the way down, the pane keeps its output and the command box in view.
    const top = await handle.boundingBox();
    if (!top) throw new Error("Missing terminal resize grip");
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await page.mouse.down();
    await page.mouse.move(top.x + top.width / 2, top.y + 900, { steps: 5 });
    await page.mouse.up();
    const least = await consolePanel.evaluate((element) => element.getBoundingClientRect().height);
    expect(least).toBeGreaterThanOrEqual(220);
    const log = computer.getByRole("log");
    expect(await log.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    await expect(editor).toBeInViewport();
    await handle.focus();
    await handle.press("ArrowUp");
    expect(await consolePanel.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(least);
    await computer.getByRole("button", { name: "Minimizar terminal", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await computer.getByRole("button", { name: "Expandir terminal", exact: true }).click();
    await expect(editor).toHaveValue("printf 'first\nsecond'\npw");
    await computer.getByRole("button", { name: "Maximizar terminal", exact: true }).click();
    await expect(computer.locator(".computer__desktop")).toBeHidden();
    await computer.getByRole("button", { name: "Restaurar terminal", exact: true }).click();
    await expect(computer.locator(".computer__desktop")).toBeVisible();
    // Asked while the owner has its screen, the agent's turn says so, and its notice hands the screen back.
    await env.client.call("threads.send", { thread: robyChat.id, text: "Seguí vos" });
    const blocked = page.locator(".notice--error", { hasText: "Tenés la pantalla de Roby en tus manos" });
    await blocked.getByRole("button", { name: "Devolver control al agente", exact: true }).click();
    await expect(blocked.getByRole("button", { name: "Control devuelto", exact: true })).toBeDisabled();
    await expect(computer.locator(".computer__locked")).toBeVisible();
    await expect(computer.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: /^Cuenta/ }).click();
    await page.getByRole("menuitem", { name: "Apariencia", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
    await settings.getByRole("switch", { name: "Oscuro", exact: true }).click();
    await expect(settings.getByRole("switch", { name: "Oscuro", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect.poll(() => calls.includes("appearance 1:dark")).toBe(true);
    finish();
    await computer.getByRole("button", { name: "Apagar para todos", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    // Off, it says why in one sentence, and says it once.
    await expect(computer.locator(".computer__setup").getByRole("status")).toHaveText(
      "La apagaste. Sus archivos quedan guardados y vuelve a arrancar como estaba.",
    );
    await expect(computer.getByText(/memoria liberada|quedan guardados/)).toHaveCount(1);
    expect(running).toBe(false);
    expect(installed).toBe(true);
    await computer.getByRole("button", { name: "Encender VM", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Apagar para todos", exact: true })).toBeVisible();
    expect(calls).toContain("prepare:dark");
    await computer.getByRole("button", { name: "Cerrar panel", exact: true }).click();
    await expect(computer).toHaveCount(0);
    expect(running).toBe(true);
  } finally {
    finish();
    try {
      await page.close();
    } finally {
      try {
        await env.core.close();
      } finally {
        env.cleanup();
      }
    }
  }
});

test("a late status poll cannot undo shutdown, and an optional VM error cannot block the office", async ({ page }) => {
  let running = true;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {
      running = true;
    },
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: "/unused", instance: "missing", lifecycle, executable: () => "/usr/bin/false" },
  });
  let release: () => void = () => {};
  let hold = false;
  let captured = false;
  let optionalFailure = false;
  let stoppedDisplayRequests = 0;
  page.on("request", (request) => {
    if (!running && request.url().endsWith("/rpc/environments.display")) stoppedDisplayRequests++;
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
    await env.client.call("environments.bind", { thread: robyChat.id });
    const stale = await env.client.call("environments.status", {});
    await mockVmDisplay(page);
    await page.route("**/rpc/environments.status", async (route) => {
      if (optionalFailure) {
        await route.fulfill({
          json: { ok: false, error: { code: "unavailable", message: "Computer temporarily unavailable" } },
        });
        return;
      }
      if (!hold) {
        await route.continue();
        return;
      }
      hold = false;
      captured = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { ok: true, result: stale } });
    });
    await page.goto(`${env.core.url}/#thread=${robyChat.id}&panel=computer`);
    const computer = page.locator(".computer");
    await expect(computer.getByRole("button", { name: "Apagar para todos", exact: true })).toBeVisible();
    hold = true;
    await expect.poll(() => captured).toBe(true);
    await computer.getByRole("button", { name: "Apagar para todos", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse((response) => response.url().endsWith("/rpc/environments.status"));
    release();
    await (await oldResponse).finished();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    expect(stoppedDisplayRequests).toBe(0);
    await expect(computer.getByRole("button", { name: "Apagar para todos", exact: true })).toHaveCount(0);
    await expect(computer.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    optionalFailure = true;
    await page.reload();
    await expect(page.locator(".computer")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Escribile a Roby…", exact: true })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
