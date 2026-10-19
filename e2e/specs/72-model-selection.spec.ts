import type { Agent, ModelChoice, RouterConfig, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("agents and chats distinguish inheritance, primary models and explicit routing", async ({ page }) => {
  await rpc("setup.finish");
  const saved = await rpc<{ default: ModelChoice; router: RouterConfig }>("models.config");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing secretary");
  const choiceOf = async () =>
    (await rpc<{ agents: Agent[] }>("agents.list")).agents.find((a) => a.id === agent.id)?.model_choice;
  try {
    await rpc("models.set_config", {
      default: { model: "custom/fake-2", router: false },
      router: { chain: ["custom/fake-1"], rules: [] },
    });
    await rpc("agents.update", { agent: agent.id, model_choice: null });
    const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Model selection" });
    await open(page, `#thread=${thread.id}`);
    const chat = page.getByRole("button", { name: "Modelo de este chat", exact: true });
    await expect(chat).toHaveText("custom/fake-2");
    await chat.click();
    const picker = page.locator(".mchoice");
    await expect(picker.getByRole("status")).toContainText("Configurado: custom/fake-2");
    await expect(
      picker.locator(".mchoice__fallback:not([role])").filter({ hasText: "El modelo del agente" }),
    ).toContainText("En uso");
    await expect(picker.getByRole("option", { selected: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openSettings(page);
    await page.getByRole("dialog").getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
    const agentButton = page.getByRole("dialog", { name: "Configuración", exact: true }).getByRole("button", {
      name: `Modelo de ${agent.name}`,
      exact: true,
    });
    await expect(agentButton).toHaveText("custom/fake-2");
    await agentButton.click();
    await expect(
      picker.locator(".mchoice__fallback:not([role])").filter({ hasText: "Predeterminado de la instalación" }),
    ).toContainText("En uso");
    await picker.getByRole("button", { name: "Dejar solo el router" }).click();
    await expect.poll(choiceOf).toEqual({ router: true });
    await expect(agentButton).toHaveText("Router · #1: custom/fake-1");
    await expect(picker.locator(".mchoice__fallback:not([role])").filter({ hasText: /^Router:/ })).toContainText(
      "En uso",
    );
    await picker.getByRole("option", { name: /custom\/fake-2/ }).click();
    await expect.poll(choiceOf).toEqual({ model: "custom/fake-2", router: true });
    await expect(agentButton).toHaveText("custom/fake-2 · Respaldo: Router");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { selected: true })).toContainText("fake-2");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(chat).toHaveText("custom/fake-2 · Respaldo: Router");
    await page
      .getByRole("region", { name: "Model selection", exact: true })
      .getByRole("button", { name: agent.name, exact: true })
      .click();
    const detail = page.locator(".teamdetail");
    await expect(detail.getByRole("button", { name: `Modelo de ${agent.name}`, exact: true })).toHaveText(
      "custom/fake-2 · Respaldo: Router",
    );
    await detail.getByRole("button", { name: `Modelo de ${agent.name}`, exact: true }).click();
    await expect(picker.getByRole("option", { selected: true })).toContainText("fake-2");
    await page.keyboard.press("Escape");
    await chat.click();
    await expect(
      picker.locator(".mchoice__fallback:not([role])").filter({ hasText: "El modelo del agente" }),
    ).toContainText("custom/fake-2 · Respaldo: Router");
    await picker.getByRole("button", { name: "Dejar solo el router" }).click();
    await expect(chat).toHaveText("Router · #1: custom/fake-1");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Volver al del agente" }).click();
    await expect(chat).toHaveText("custom/fake-2 · Respaldo: Router");

    // A fixed model without fallback must stay fixed when selected again.
    await rpc("agents.update", { agent: agent.id, model_choice: { model: "custom/fake-2", router: false } });
    await page.reload();
    await expect(chat).toHaveText("custom/fake-2");
    await openSettings(page);
    await page.getByRole("dialog").getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
    await agentButton.click();
    await picker.getByRole("option", { selected: true }).click();
    await expect.poll(choiceOf).toEqual({ model: "custom/fake-2", router: false });

    await page.route("**/rpc/agents.update", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "unavailable", message: "Model update refused" } }),
      }),
    );
    try {
      await picker.getByRole("option", { name: /custom\/fake-1/ }).click();
      await expect(page.getByText(/No se pudo cambiar el modelo: Model update refused/)).toBeVisible();
      await expect(agentButton).toHaveText("custom/fake-2");
      await expect(picker).toBeVisible();
      await expect(picker.getByRole("option", { selected: true })).toContainText("fake-2");
      await expect.poll(choiceOf).toEqual({ model: "custom/fake-2", router: false });
    } finally {
      await page.unroute("**/rpc/agents.update");
    }
  } finally {
    await rpc("agents.update", { agent: agent.id, model_choice: agent.model_choice ?? null });
    await rpc("models.set_config", saved);
  }
});

test("router previews identify rules and do not predict the turn's selected model", async ({ page }) => {
  await rpc("setup.finish");
  const saved = await rpc<{ default: ModelChoice; router: RouterConfig }>("models.config");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing secretary");
  try {
    await rpc("agents.update", { agent: agent.id, model_choice: { router: true } });
    await rpc("models.set_config", {
      router: { chain: ["custom/fake-1"], rules: [{ when: { has_image: true }, model: "custom/fake-2" }] },
    });
    const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Routing rules" });
    await open(page, `#thread=${thread.id}`);
    const chat = page.getByRole("button", { name: "Modelo de este chat", exact: true });
    await expect(chat).toHaveText("Router · Reglas · #1: custom/fake-1");
    await chat.click();
    await expect(
      page.locator(".mchoice").getByText("Router: Reglas · #1: custom/fake-1", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".mchoice").getByRole("status")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await rpc("models.set_config", { router: { chain: [], rules: [{ when: {}, model: "custom/fake-2" }] } });
    await page.reload();
    await expect(chat).toHaveText("Router · Reglas");
    await rpc("models.set_config", { router: { chain: [], rules: [] } });
    await page.reload();
    await expect(chat).toHaveText("Router");
  } finally {
    await rpc("agents.update", { agent: agent.id, model_choice: agent.model_choice ?? null });
    await rpc("models.set_config", saved);
  }
});

test("model choices keep effort visible and stay open while editing", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing secretary");
  await page.route("**/rpc/models.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const engine = body.result.engines.find((e: { id: string }) => e.id === "custom");
    const model = engine.models.find((m: { id: string }) => m.id === "fake-2");
    model.efforts = ["low", "high"];
    model.default_effort = "low";
    await route.fulfill({ response, json: body });
  });
  const thread = await rpc<Thread>("threads.create", {
    kind: "loose",
    agent_id: agent.id,
    title: "Edit model and effort",
  });
  await rpc("threads.model", { thread: thread.id, model_choice: { router: true } });
  await open(page, `#thread=${thread.id}`);
  const trigger = page.getByRole("button", { name: "Modelo de este chat", exact: true });
  await trigger.click();
  const picker = page.locator(".mchoice");
  const effort = picker.getByRole("combobox", { name: "Effort", exact: true });
  await expect(effort).toBeVisible();
  await expect(effort).toBeDisabled();
  await picker.getByRole("option", { name: /custom\/fake-2/ }).click();
  await expect(picker).toBeVisible();
  await expect(effort).toBeEnabled();
  await effort.click();
  await page.getByRole("option", { name: "Alto", exact: true }).click();
  await expect(trigger).toContainText("custom/fake-2 · Alto");
  await expect(picker).toBeVisible();
  await expect(effort).toHaveText("Alto");
  const listBox = await picker.getByRole("listbox").boundingBox();
  const effortBox = await effort.boundingBox();
  if (!listBox || !effortBox) throw new Error("Missing model or effort bounds");
  expect(effortBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);
  await expect(picker.locator(".mlist__effort")).toHaveCSS("border-top-width", "1px");
  await expect(picker.locator(".mlist__effort")).toHaveCSS("border-left-width", "0px");
  for (const row of await picker.locator(".mchoice__fallback").all()) {
    const rowBox = await row.boundingBox();
    const actionBox = await row.getByRole("button").boundingBox();
    if (!rowBox || !actionBox) throw new Error("Missing quick action bounds");
    expect(Math.abs(actionBox.x + actionBox.width - (rowBox.x + rowBox.width - 4))).toBeLessThan(1);
  }
  const routerRow = picker.locator(".mchoice__fallback").first();
  const routerTitle = await routerRow.locator(".mchoice__title").boundingBox();
  const routerAction = await routerRow.getByRole("button").boundingBox();
  if (!routerTitle || !routerAction) throw new Error("Missing router bounds");
  expect(Math.abs(routerTitle.y + routerTitle.height / 2 - (routerAction.y + routerAction.height / 2))).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath("model-picker-desktop.png") });
  await page.reload();
  await expect(trigger).toContainText("custom/fake-2 · Alto");
  await trigger.click();
  await expect(effort).toHaveText("Alto");
  await picker.getByRole("option", { name: /custom\/fake-1/ }).click();
  await expect(picker).toBeVisible();
  await expect(effort).toBeDisabled();
  await expect(effort).toBeVisible();
  await expect(picker.getByText("La primera regla que coincida", { exact: false })).toHaveCount(0);
  await expect(picker.getByRole("status")).toContainText("Configurado:");
  await expect(picker.locator(":scope > :first-child")).toHaveCSS("border-top-width", "0px");
  await expect(picker.getByRole("status")).toHaveCSS("white-space", "nowrap");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 740 });
  await trigger.click();
  const popup = page.getByRole("dialog", { name: "Modelo de este chat", exact: true });
  await expect(popup).toBeVisible();
  const popupBox = await popup.boundingBox();
  if (!popupBox) throw new Error("Missing popup bounds");
  expect(popupBox.x).toBeGreaterThanOrEqual(0);
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(390);
  await expect(effort).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("model-picker-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});
