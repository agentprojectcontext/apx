// What Auto decided about each deletion or other call shows on the chat's step and in Settings › Agents
// (DECISIONS.md#d-281, DECISIONS.md#d-283).
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { workDir } from "../../apps/core/src/tools/folders.ts";
import { expect, test } from "./kit.ts";

const JUDGE = "You decide whether an AI agent may run a deletion";
const ACTION_JUDGE = "You decide whether an AI agent working for its owner";

const auto = test.extend<{ autoCore: Awaited<ReturnType<typeof startCore>> }>({
  autoCore: async ({ baseURL: _baseURL }, use) => {
    const env = await startCore({
      port: 0,
      llm: scriptedLlm((req, { said, afterTool }) => {
        if (String(req.messages[0]?.content).startsWith(JUDGE))
          return say('{"decision":"run","why":"registros que dejó esta misma tarea"}');
        if (String(req.messages[0]?.content).startsWith(ACTION_JUDGE))
          return say('{"decision":"run","why":"revisa el runner del proyecto"}');
        if (afterTool) return say("Listo.");
        if (said.includes("coverage")) return callTool("c1", "shell", { command: "rm -rf coverage" });
        if (said.includes("runner"))
          return callTool("r1", "shell", {
            command: "ssh -o BatchMode=yes -o ConnectTimeout=1 runner.host.invalid 'docker ps'",
          });
        if (said.includes("registros"))
          return callTool("j1", "shell", { command: "find tmp-logs -name '*.log' -exec rm -f {} +" });
        return callTool("g1", "shell", { command: "rm -rf logs/*" });
      }),
    });
    try {
      await use(env);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  },
});

auto("the step says what Auto decided and the settings list every decision", async ({ page, autoCore: env }, info) => {
  try {
    await env.client.call("setup.finish", {});
    env.core.store.settings.set("model_aux", "openai/gpt-4o-mini");
    const cwd = workDir(env.core.store, env.home, {});
    await mkdir(path.join(cwd, "coverage", "all"), { recursive: true });
    await mkdir(path.join(cwd, "tmp-logs"), { recursive: true });
    await writeFile(path.join(cwd, "tmp-logs", "run.log"), "x\n");
    await mkdir(path.join(cwd, "logs"), { recursive: true });
    await writeFile(path.join(cwd, "logs", "app.log"), "the owner's\n");
    const born = (await stat(path.join(cwd, "logs", "app.log"))).birthtimeMs;
    await expect.poll(() => Date.now() > born + 2).toBe(true);
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Limpieza" });
    for (const text of ["borrá coverage", "borrá los registros", "mirá el runner"]) {
      await env.client.call("threads.send", { thread: chat.id, text });
      await env.settle(chat.id);
    }
    await env.client.call("threads.send", { thread: chat.id, text: "vaciá logs" });
    await expect.poll(async () => (await env.client.call("runs.pending", { thread: chat.id })).inputs.length).toBe(1);

    const lines = page.locator(".turn__autodel");
    for (const [width, layout] of [
      [1280, "desktop"],
      [390, "phone"],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${env.core.url}/#thread=${chat.id}`);
      await expect(lines).toHaveCount(4);
      await expect(lines.nth(0)).toContainText("Auto lo borró: salida de build o de tests");
      await expect(lines.nth(1)).toContainText("Auto lo borró: registros que dejó esta misma tarea");
      await expect(lines.nth(2)).toContainText("Auto siguió: revisa el runner del proyecto");
      await expect(lines.nth(3)).toContainText("Auto te preguntó: archivos tuyos que no hizo en esta tarea");
      await lines.nth(2).getByRole("button").first().click();
      await expect(lines.nth(2)).toContainText("Lo decidió el modelo ayudante: revisa el runner del proyecto");
      await lines.nth(2).scrollIntoViewIfNeeded();
      const file = info.outputPath(`auto-decisions-${layout}-chat.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      await info.attach(`auto-decisions-${layout}-chat`, { path: file, contentType: "image/png" });

      await page.getByRole("button", { name: /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Agentes", exact: true }).click();
      const list = page.locator(".autodels");
      await expect(list.locator(".autodels__row")).toHaveCount(4);
      await expect(list.locator(".autodels__row").first()).toContainText("Auto te preguntó");
      const judged = list.locator(".autodels__row").nth(1);
      await expect(judged).toContainText("Roby · Modelo ayudante");
      await judged.getByRole("button").first().click();
      await expect(judged).toContainText("Lo decidió el modelo ayudante: revisa el runner del proyecto");
      await list.scrollIntoViewIfNeeded();
      const shot = info.outputPath(`auto-decisions-${layout}-settings.png`);
      await page.screenshot({ path: shot, animations: "disabled" });
      await info.attach(`auto-decisions-${layout}-settings`, { path: shot, contentType: "image/png" });
      await list.getByRole("radio", { name: "Siguió" }).click();
      await expect(list.locator(".autodels__row")).toHaveCount(3);
      await list.getByRole("radio", { name: "Todos" }).click();
      await expect(list.locator(".autodels__row")).toHaveCount(4);
      await page.keyboard.press("Escape");
    }
    // A decision opens its chat.
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto(`${env.core.url}/#thread=home`);
    await page.getByRole("button", { name: /^Cuenta/ }).click();
    await page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Agentes", exact: true }).click();
    const first = page.locator(".autodels__row").first();
    await first.getByRole("button").first().click();
    await first.getByRole("button", { name: "Abrir el chat" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`thread=${chat.id}`));
  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
  }
});
