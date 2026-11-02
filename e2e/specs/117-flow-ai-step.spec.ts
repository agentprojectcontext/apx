// An AI model step answered by a bot of the flow (a name and how it works, on APX's harness), whose answer a command
// reads through values inserted with the picker: the step's answer and a secret, shown as badges. A value named in
// its task is sent as written, and the field says so. The fake model answers in the sandbox core; no real model or
// channel is reached. FLOW_SHOTS=<folder> also saves screenshots.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    add: (k: string) => `Add ${k}`,
    hook: "Incoming webhook",
    ai: "AI model",
    cmd: "Cmd",
    bot: "A bot for this flow",
    agent: "An agent",
    botName: "Bot name",
    system: "How it works",
    task: "Instruction",
    asWritten: "$trigger.text is sent as written: this step doesn't fill in values.",
    harness: "Harness",
    apx: "APX",
    delegate: "Can ask other agents",
    command: "Command",
    env: "Variables",
    stdin: "Input",
    pick: "Insert a value",
    secrets: "Secrets",
    save: "Save",
    saved: "Saved. Turn it on to run it as drawn.",
    exit: "Exit",
    close: "Exit the editor",
    toggle: (n: string) => `Turn ${n} on or off`,
    allowTitle: "Let this flow act for you?",
    withSecret: "With the secret flow_key",
    allow: "Allow",
    answered: "Answered by Triage on APX",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    add: (k: string) => `Sumar ${k}`,
    hook: "Webhook entrante",
    ai: "Modelo IA",
    cmd: "Cmd",
    bot: "Un bot de este flow",
    agent: "Un agente",
    botName: "Nombre del bot",
    system: "Cómo trabaja",
    task: "Instrucción",
    asWritten: "$trigger.text se manda tal como está: este paso no completa valores.",
    harness: "Harness",
    apx: "APX",
    delegate: "Puede pedirle a otros agentes",
    command: "Comando",
    env: "Variables",
    stdin: "Entrada",
    pick: "Insertar un valor",
    secrets: "Secretos",
    save: "Guardar",
    saved: "Guardado. Prendelo para que corra como está dibujado.",
    exit: "Salir",
    close: "Salir del editor",
    toggle: (n: string) => `Encender o apagar ${n}`,
    allowTitle: "¿Dejás que este flow actúe por vos?",
    withSecret: "Con el secreto flow_key",
    allow: "Permitir",
    answered: "Respondió Triage en APX",
  },
};

const shots = process.env.FLOW_SHOTS;
/** `focus` is scrolled into view at each width. */
async function shot(page: Page, name: string, phone = false, focus?: Locator) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await focus?.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  if (!phone) return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await focus?.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
}

for (const lang of ["en", "es"] as const) {
  test(`a bot of the flow answers and a command reads its answer and a secret picked as badges (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    await rpc("secrets.set", { name: "flow_key", value: `sk-flow-e2e-${lang}-0123456789` });
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `AI step ${lang}` })).project.id;
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const name = `Triage ${lang}`;
    await open(page, `#view=flows&scope=${project}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: l.add(l.hook) }) });
    await editor.getByRole("textbox", { name: l.name }).fill(name);
    // The top bar has the name at the left and Exit at the right; no close button by the window's own.
    await expect(editor.getByRole("button", { name: l.close })).toHaveText(l.exit);

    await editor.getByRole("button", { name: l.add(l.hook) }).click();
    await editor.getByRole("button", { name: l.add(l.ai) }).click();
    // An agent first: delegating to other agents is off until the step allows it.
    await expect(editor.getByRole("radio", { name: l.agent })).toBeChecked();
    await expect(editor.getByRole("switch", { name: l.delegate })).not.toBeChecked();
    await shot(page, `ai-agent-${lang}`, true);
    await editor.getByRole("radio", { name: l.bot }).click();
    await expect(editor.getByRole("switch", { name: l.delegate })).toHaveCount(0);
    await editor.getByRole("textbox", { name: l.botName }).fill("Triage");
    await editor.getByRole("textbox", { name: l.system }).fill("Label each request: damage, billing or other.");
    // A value named in the task is sent as written, and the field says so; plain words say nothing.
    const task = editor.getByRole("textbox", { name: l.task });
    await task.fill("Label $trigger.text as damage, billing or other.");
    // By the page: at phone width the editor shows no step palette, which `editor` is found by.
    const hint = page.getByText(l.asWritten);
    await expect(hint).toBeVisible();
    await shot(page, `ai-task-refs-${lang}`, true, hint);
    await task.fill("Label this request.");
    await expect(editor.getByText(l.asWritten)).toHaveCount(0);
    await expect(editor.getByRole("combobox", { name: l.harness })).toContainText(l.apx);
    await shot(page, `ai-bot-${lang}`, true);

    await editor.getByRole("button", { name: l.add(l.cmd) }).click();
    await editor.getByRole("textbox", { name: l.command }).fill('printf "%s|%s" "$ANSWER" "$KEY"');
    const env = editor.getByRole("textbox", { name: l.env });
    // Typing {{ offers the values; the bot's answer goes in as a badge.
    await env.click();
    await env.pressSequentially("ANSWER={{");
    await page.getByRole("option", { name: /\$steps\.agent-1\.text/ }).click();
    await env.press("End");
    await env.press("Enter");
    await env.pressSequentially("KEY=");
    // The button offers everything, secrets among them in this field.
    await editor.getByRole("button", { name: l.pick }).first().click();
    await expect(page.getByRole("group", { name: l.secrets })).toBeVisible();
    await shot(page, `picker-${lang}`);
    await page.getByRole("option", { name: /secret:\/\/flow_key/ }).click();
    await expect(env).toHaveValue("ANSWER=$steps.agent-1.text\nKEY=secret://flow_key");
    await expect(editor.locator(".apx-tfield__chip", { hasText: "$steps.agent-1.text" })).toBeVisible();
    await expect(editor.locator(".apx-tfield__chip.is-secret", { hasText: "secret://flow_key" })).toBeVisible();
    // The command's input is text it reads as it is: no secret is offered there.
    const stdin = editor.getByRole("textbox", { name: l.stdin });
    await stdin.click();
    await stdin.pressSequentially("secret://");
    await expect(page.getByRole("option", { name: /secret:\/\// })).toHaveCount(0);
    await stdin.fill("");
    await shot(page, `badges-${lang}`, true);

    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    await editor.getByRole("button", { name: l.close }).click();

    await page.getByRole("switch", { name: l.toggle(name) }).click();
    const ask = page.getByRole("dialog", { name: l.allowTitle });
    await expect(ask).toContainText(l.withSecret);
    await ask.getByRole("button", { name: l.allow }).click();
    await expect(page.getByRole("switch", { name: l.toggle(name) })).toBeChecked();
    const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
    const graph = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    const ai = graph.published?.nodes.find((n) => n.id === "agent-1");
    expect(ai?.kind === "agent" && ai.bot).toEqual({
      name: "Triage",
      system: "Label each request: damage, billing or other.",
    });

    await rpc("flows.run_now", { flow, data: { text: "The lamp arrived broken" } });
    await expect
      .poll(async () => (await rpc<Result<"flows.events">>("flows.events", { flow })).events.map((e) => e.state))
      .toEqual(["succeeded"]);
    const event = (await rpc<Result<"flows.events">>("flows.events", { flow })).events[0]?.event_id ?? "";
    const run = await rpc<Result<"flows.run_get">>("flows.run_get", { flow, event });
    const out = JSON.parse(run.steps.find((s) => s.node === "cmd-1")?.output ?? "null");
    expect(out.stdout).toMatch(/^Got it: .+\|\[secret\]$/);
    expect(JSON.stringify(run)).not.toContain(`sk-flow-e2e-${lang}`);

    // The run says who answered, on which harness, and opens its chat.
    await page.reload();
    await page.locator('.react-flow__node[data-id="agent-1"]').click();
    await expect(page.getByText(l.answered)).toBeVisible();
    await shot(page, `run-detail-${lang}`, true);
  });
}
