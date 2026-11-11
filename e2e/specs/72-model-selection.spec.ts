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
    // The composer's chip names the model beside its provider's mark; its picker says what runs now.
    const chat = page.getByRole("button", { name: "Modelo de este chat", exact: true });
    await expect(chat).toHaveText("fake-2");
    await chat.click();
    const picker = page.locator(".mchoice");
    await expect(picker.getByRole("status")).toContainText("fake-2");
    await expect(picker.getByRole("status")).toContainText("En uso");
    // Inherited from the agent: nothing chosen in the list and nothing to go back to.
    await expect(picker.getByRole("button", { name: "Volver al del agente" })).toHaveCount(0);
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
    await picker.getByRole("button", { name: "Elegir automáticamente" }).click();
    await expect.poll(choiceOf).toEqual({ router: true });
    await expect(agentButton).toHaveText("Automático · Primero: custom/fake-1");
    await expect(
      picker.locator(".mchoice__fallback:not([role])").filter({ hasText: /^Automático · Primero:/ }),
    ).toContainText("En uso");
    await picker.getByRole("option", { name: /custom\/fake-2/ }).click();
    await expect.poll(choiceOf).toEqual({ model: "custom/fake-2", router: true });
    await expect(agentButton).toHaveText("custom/fake-2 · Respaldo automático");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { selected: true })).toContainText("fake-2");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(chat).toHaveText("fake-2");
    await page
      .getByRole("region", { name: "Model selection", exact: true })
      .getByRole("button", { name: `Ver a ${agent.name}`, exact: true })
      .click();
    const detail = page.locator(".teamdetail");
    await expect(detail.getByRole("button", { name: `Modelo de ${agent.name}`, exact: true })).toHaveText(
      "custom/fake-2 · Respaldo automático",
    );
    await detail.getByRole("button", { name: `Modelo de ${agent.name}`, exact: true }).click();
    await expect(picker.getByRole("option", { selected: true })).toContainText("fake-2");
    await page.keyboard.press("Escape");
    await chat.click();
    // Now the agent's model, then the router if it fails.
    await expect(picker.getByRole("status")).toContainText("fake-2");
    await expect(picker.locator(".mslim__slot").nth(1)).toContainText("fake-1 · router");
    await expect(picker.locator(".mslim__slot").nth(1)).toContainText("Si falla");
    await picker.getByRole("button", { name: "Dejar solo el router" }).click();
    await expect(chat).toHaveText("Automático · Primero: custom/fake-1");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Volver al del agente" }).click();
    await expect(chat).toHaveText("fake-2");

    // A fixed model without fallback must stay fixed when selected again.
    await rpc("agents.update", { agent: agent.id, model_choice: { model: "custom/fake-2", router: false } });
    await page.reload();
    await expect(chat).toHaveText("fake-2");
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
    await expect(chat).toHaveText("Automático · Reglas · Primero: custom/fake-1");
    await chat.click();
    // With rules the router is named by its route, not by a model it may not pick.
    await expect(page.locator(".mchoice").getByRole("status")).toContainText(
      "Automático · Reglas · Primero: custom/fake-1",
    );
    await page.keyboard.press("Escape");
    await rpc("models.set_config", { router: { chain: [], rules: [{ when: {}, model: "custom/fake-2" }] } });
    await page.reload();
    await expect(chat).toHaveText("Automático · Reglas");
    await rpc("models.set_config", { router: { chain: [], rules: [] } });
    await page.reload();
    await expect(chat).toHaveText("Automático");
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
  const longName = "Northwind assistant with a long name and an important distinguishing version";
  await page.route("**/rpc/models.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const engine = body.result.engines.find((e: { id: string }) => e.id === "custom");
    const model = engine.models.find((m: { id: string }) => m.id === "fake-2");
    model.efforts = ["low", "high"];
    model.default_effort = "low";
    engine.models.find((m: { id: string }) => m.id === "fake-1").name = longName;
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
  // No model with efforts yet: the row stays, its list disabled.
  const effort = picker.getByRole("combobox", { name: "Esfuerzo", exact: true });
  await expect(effort).toBeVisible();
  await expect(effort).toBeDisabled();
  await picker.getByRole("option", { name: /^fake-2/ }).click();
  await expect(picker).toBeVisible();
  // A few levels: one row of buttons, the model's default marked until another is picked.
  const levels = picker.getByRole("radiogroup", { name: "Esfuerzo", exact: true });
  const high = levels.getByRole("radio", { name: "Alto", exact: true });
  await expect(levels.getByRole("radio", { name: "Bajo", exact: true })).toBeChecked();
  await high.click();
  await expect(trigger).toHaveText("fake-2 Alto");
  await expect(picker).toBeVisible();
  await expect(high).toBeChecked();
  const listBox = await picker.getByRole("listbox").boundingBox();
  const effortBox = await levels.boundingBox();
  if (!listBox || !effortBox) throw new Error("Missing model or effort bounds");
  expect(effortBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);
  // What runs now and after sits under the list, set apart by a line.
  await expect(picker.locator(".mslim__foot")).toHaveCSS("border-top-width", "1px");
  await expect(picker.getByRole("option", { selected: true })).toContainText("Elegido");
  await page.screenshot({ path: test.info().outputPath("model-picker-desktop.png") });
  await page.reload();
  await expect(trigger).toHaveText("fake-2 Alto");
  await trigger.click();
  await expect(high).toBeChecked();
  // Back to the model's default: the chat follows it again instead of naming a level.
  await levels.getByRole("radio", { name: "Bajo", exact: true }).click();
  await expect(trigger).not.toContainText("Alto");
  await high.click();
  await expect(trigger).toHaveText("fake-2 Alto");
  await picker.getByRole("option", { name: longName }).click();
  await expect(picker).toBeVisible();
  await expect(effort).toBeDisabled();
  await expect(effort).toBeVisible();
  await expect(picker.getByText("La primera regla que coincida", { exact: false })).toHaveCount(0);
  await expect(picker.getByRole("status")).toContainText("En uso");
  await expect(picker.locator(":scope > :first-child")).toHaveCSS("border-top-width", "0px");
  await expect(picker.getByRole("status")).toContainText("fake-1");
  expect(await picker.getByRole("status").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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
  // A long name wraps instead of hiding what tells it apart.
  const longOption = picker.getByRole("option", { name: longName });
  await expect(longOption.locator(".mlist__name")).toHaveText(longName);
  for (const text of [longOption.locator(".mlist__name"), picker.getByRole("status")]) {
    expect(
      await text.evaluate(
        (element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("model-picker-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
});
