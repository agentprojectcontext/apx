import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { ApxClient } from "../../packages/protocol/src/client.ts";

const runtime = path.resolve(process.argv[2] ?? "");
const info = JSON.parse(fs.readFileSync(path.join(runtime, "running.json"), "utf8")) as { url: string };
const client = new ApxClient({ url: new URL(info.url).origin });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1640, height: 1050 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(info.url);
  await page.evaluate(() =>
    localStorage.setItem("apx.prefs", JSON.stringify({ language: "es", panelW: 1000, sidebarCollapsed: true })),
  );
  await page.reload();
  await expect(page.locator(".computer__status.is-on")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".computer__screen canvas")).toBeVisible();
  await client.call("environments.control", { screen: 1, mode: "human" });
  await expect(page.getByRole("button", { name: /Devolver control|Return control/ })).toBeVisible();
  const command = page.getByRole("textbox", { name: /Comando dentro|Command inside/ });
  await command.fill("printf 'VM-RUNTIME-PROOF\\n'; uname -s; pwd");
  await page.getByRole("button", { name: /^(Enviar|Send)$/ }).click();
  await expect(page.locator(".computer__console pre")).toContainText("VM-RUNTIME-PROOF\nLinux\n/home/apx-a1/work", {
    timeout: 20_000,
  });
  const reports = page.getByText("Demo programada terminada.", { exact: false });
  const previousReports = await reports.count();
  await client.call("environments.control", { screen: 1, mode: "agent" });
  await client.call("threads.send", {
    thread: "home",
    text: "Demostración VM: abrir navegador y terminal, crear informe ficticio.",
  });
  await expect(reports).toHaveCount(previousReports + 1, { timeout: 60_000 });
  await client.call("environments.control", { screen: 1, mode: "human" });
  await expect(page.getByRole("button", { name: /Devolver control|Return control/ })).toBeVisible();
  await command.fill(
    "set -e; systemctl --user is-active apx-demo-browser.service apx-demo-terminal.service; cat report.txt; xdotool search --sync --onlyvisible --name 'Acme workspace' windowactivate --sync; xdotool search --onlyvisible --name '^APX-VM$' windowactivate --sync",
  );
  await page.getByRole("button", { name: /^(Enviar|Send)$/ }).click();
  await expect(page.locator(".computer__console pre")).toContainText("active\nactive\nAcme Store", { timeout: 20_000 });
  const canvas = page.locator(".computer__screen canvas");
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const c = element as HTMLCanvasElement;
          const pixels = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
          if (!pixels) return 0;
          let light = 0;
          for (let i = 0; i < pixels.length; i += 64)
            if ((pixels[i] ?? 0) > 175 && (pixels[i + 1] ?? 0) > 175 && (pixels[i + 2] ?? 0) > 175) light++;
          return light / (pixels.length / 64);
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0.15);
  await canvas.focus();
  await page.keyboard.type("printf 'KEYBOARD-PROOF' > interactive.txt", { delay: 25 });
  await page.keyboard.press("Enter");
  await command.fill("cat interactive.txt");
  await page.getByRole("button", { name: /^(Enviar|Send)$/ }).click();
  await expect(page.locator(".computer__console pre")).toContainText("KEYBOARD-PROOF", { timeout: 20_000 });
  await page.screenshot({ path: path.join(runtime, "apx-vm-prototype.png"), fullPage: true });
  assert.deepEqual(errors, []);
  process.stdout.write("PASS: real desktop, VM command, scripted native turn and browser console\n");
} finally {
  await browser.close();
}
