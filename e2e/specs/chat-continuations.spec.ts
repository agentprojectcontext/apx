import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const SHOTS = process.env.SHOTS;
const webDist = fileURLToPath(new URL("../../apps/web/dist", import.meta.url));

test("expired and revoked follow-ups explain why they did not start, without inventing a run", async ({ page }) => {
  let clock = new Date("2026-10-05T10:00:00Z");
  const llm = scriptedLlm(() => say("Must not run"));
  const env = await startCore({ llm, clock: () => clock, webDist });
  try {
    await env.client.call("setup.finish", {});
    const condition = { kind: "time" as const, at: "2026-10-05T10:10:00Z" };
    await env.client.call("continuations.create", {
      thread: "home",
      purpose: "Comprobar el informe antes del cierre",
      condition,
      expires_at: "2026-10-05T10:15:00Z",
    });
    await env.client.call("continuations.create", {
      thread: "home",
      purpose: "Revisar el estado con los permisos acordados",
      condition,
      expires_at: "2026-10-05T11:00:00Z",
    });
    await env.client.call("agents.update", { agent: "superagent", autonomy: "manual" });
    clock = new Date("2026-10-05T10:20:00Z");
    env.core.scheduler.tick();
    await page.goto(`${env.core.url}/#thread=home`);
    const receipts = page.locator(".continuation-notice");
    await expect(receipts).toHaveCount(2);
    await expect(receipts.first()).toContainText("Venció la espera");
    await expect(receipts.last()).toContainText("No pude continuar");
    await expect(receipts.last()).toContainText("Cambió el acceso");
    await expect(receipts.getByRole("button")).toHaveCount(0);
    expect(llm.calls.length).toBe(0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "continuation-blocked-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(receipts.last()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "continuation-blocked-phone.png") });
    await page.reload();
    await expect(receipts).toHaveCount(2);
    await expect(receipts.last()).toContainText("No pude continuar");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("a chat follow-up keeps its receipt through reload, cancels by keyboard, and links its same-chat result", async ({
  page,
}) => {
  let clock = new Date("2026-10-05T10:00:00Z");
  const at = "2026-10-05T10:10:00Z";
  const expires_at = "2026-10-05T11:00:00Z";
  let task = "";
  const llm = scriptedLlm((_req, { said, afterTool }) => {
    if (said.includes("continuation_request")) {
      if (!afterTool) return callTool("read", "task_get", { task });
      return say(
        "Comprobación de solo lectura: terminó la tarea simulada. No hay evidencia del estado de ningún aparato. No inicié nada.",
      );
    }
    if (afterTool) return say("Guardé el seguimiento en este chat.");
    return callTool("follow", "chat_followup", {
      action: "create",
      purpose: said.includes("termine") ? "Revisar el resultado simulado" : "Comprobar el informe",
      condition: said.includes("termine") ? { kind: "task_done", task } : { kind: "time", at },
      expires_at,
    });
  });
  const env = await startCore({ llm, clock: () => clock, webDist });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
    env.core.store.settings.write("notices", {
      ...env.core.store.settings.read("notices"),
      channel: "none",
      quiet_from: "00:00",
      quiet_to: "23:59",
    });
    task = (await env.client.call("tasks.create", { title: "Fin del ciclo simulado" })).id;
    await page.goto(`${env.core.url}/#thread=home`);
    const receipts = page.locator(".continuation-notice");
    await expect(receipts).toHaveCount(0);
    const composer = page.getByRole("textbox", { name: "Escribile a Roby…" });
    await composer.fill("Volvé en diez minutos y comprobá el informe");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(receipts).toHaveCount(1);
    await expect(receipts.first()).toContainText("Programado");
    await expect(receipts.first()).toContainText("Hasta");
    await expect(receipts.first().getByRole("button", { name: "Ver ejecución", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(receipts.first()).toContainText("Programado");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "continuation-scheduled-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(receipts.first()).toContainText("Programado");
    const cancel = receipts.first().getByRole("button", { name: "Cancelar: Comprobar el informe" });
    await expect(cancel).toBeVisible();
    await cancel.focus();
    await expect(cancel).toBeFocused();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "continuation-scheduled-phone.png") });
    await cancel.press("Enter");
    await expect(receipts.first()).toContainText("Cancelado");
    await expect(receipts.first().locator("strong")).toBeFocused();
    await expect(cancel).toHaveCount(0);
    await page.reload();
    await expect(receipts.first()).toContainText("Cancelado");
    await composer.fill("Cuando termine la tarea de prueba, revisá el resultado");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(receipts).toHaveCount(2);
    await expect(receipts.last()).toContainText("En espera");
    await expect(receipts.last()).toContainText("Fin del ciclo simulado");
    const calls = llm.calls.length;
    clock = new Date("2026-10-05T10:11:00Z");
    env.core.scheduler.tick();
    expect(llm.calls.length).toBe(calls);
    await env.client.call("tasks.close", { task, state: "done" });
    env.core.scheduler.tick();
    await expect(receipts.last()).toContainText("Completado");
    const saved = (await env.client.call("continuations.list", { thread: "home" })).continuations.find(
      (c) => c.condition.kind === "task_done",
    );
    const steps = env.core.store.runs.steps(saved?.run_id ?? "");
    expect(steps.some((s) => s.tool === "task_get" && s.state === "ok" && s.args.task === task)).toBe(true);
    const result = page.getByText("Comprobación de solo lectura: terminó la tarea simulada.", { exact: false });
    await expect(result).toBeVisible();
    const view = receipts.last().getByRole("button", { name: "Ver ejecución", exact: true });
    await view.scrollIntoViewIfNeeded();
    await view.press("Enter");
    await expect(result).toBeVisible();
    await expect(result.locator("xpath=ancestor::*[@data-msg][1]")).toBeFocused();
    await expect(receipts).toHaveCount(2);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, "continuation-result-phone.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(SHOTS, "continuation-result-desktop.png") });
    }
    await page.reload();
    await expect(receipts.last()).toContainText("Completado");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
