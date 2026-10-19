import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

test("Computer installs only on enable, follows APX appearance and exposes stop/restart", async ({ page }) => {
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
    appearance: async (mode) => {
      calls.push(`appearance:${mode}`);
    },
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-computer-ui-"));
  const env = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: {
      limaHome: path.join(home, "no-vms"),
      instance: "missing",
      lifecycle,
      executable: () => "/usr/bin/false",
    },
  });
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
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
    await env.client.call("setup.finish", {});
    await page.addInitScript((origin) => {
      if (location.origin === origin) localStorage.setItem("apx.mode", "light");
    }, env.core.url);
    await page.goto(`${env.core.url}/#thread=home&panel=computer`);
    const computer = page.locator(".computer");
    await expect(computer.getByRole("button", { name: "Activar Computadora", exact: true })).toBeVisible();
    expect(calls).toEqual([]);
    await computer.getByRole("button", { name: "Activar Computadora", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Apagar VM", exact: true })).toBeVisible();
    expect(calls).toContain("prepare:light");
    await expect(computer.locator(".computer__locked")).toBeVisible();
    await expect(computer.locator(".computer__notice")).toHaveCount(0);
    await expect(computer.getByRole("button", { name: "Probar agente", exact: true })).toHaveCount(0);
    await computer.getByRole("button", { name: "Tomar control", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Devolver control al agente", exact: true })).toBeVisible();
    await expect(computer.locator(".computer__locked")).toHaveCount(0);
    const editor = computer.getByRole("textbox", { name: "Comando dentro de la VM" });
    await editor.fill("printf 'first\nsecond'\npwd");
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
    await handle.focus();
    await handle.press("ArrowUp");
    expect(await consolePanel.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(before);
    await computer.getByRole("button", { name: "Minimizar terminal", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await computer.getByRole("button", { name: "Expandir terminal", exact: true }).click();
    await expect(editor).toHaveValue("printf 'first\nsecond'\npw");
    await computer.getByRole("button", { name: "Maximizar terminal", exact: true }).click();
    await expect(computer.locator(".computer__desktop")).toBeHidden();
    await computer.getByRole("button", { name: "Restaurar terminal", exact: true }).click();
    await expect(computer.locator(".computer__desktop")).toBeVisible();
    await computer.getByRole("button", { name: "Devolver control al agente", exact: true }).click();
    await expect(computer.locator(".computer__locked")).toBeVisible();
    await expect(computer.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Modo oscuro", exact: true }).click();
    await expect.poll(() => calls.includes("appearance:dark")).toBe(true);
    await computer.getByRole("button", { name: "Apagar VM", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Encender VM", exact: true })).toBeVisible();
    expect(running).toBe(false);
    expect(installed).toBe(true);
    await computer.getByRole("button", { name: "Encender VM", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Apagar VM", exact: true })).toBeVisible();
    expect(calls).toContain("prepare:dark");
    await computer.getByRole("button", { name: "Cerrar panel", exact: true }).click();
    await expect(computer).toHaveCount(0);
    expect(running).toBe(true);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
