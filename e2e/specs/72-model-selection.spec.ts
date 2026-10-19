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
    await expect(picker.getByRole("status")).toContainText("Selección configurada: custom/fake-2");
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
    await agentButton.click();
    await expect(picker.locator(".mchoice__fallback:not([role])").filter({ hasText: /^Router · #1:/ })).toContainText(
      "En uso",
    );
    await picker.getByRole("option", { name: /custom\/fake-2/ }).click();
    await expect.poll(choiceOf).toEqual({ model: "custom/fake-2", router: true });
    await expect(agentButton).toHaveText("custom/fake-2 · Respaldo: Router");
    await agentButton.click();
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
    await chat.click();
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
      await agentButton.click();
      await picker.getByRole("option", { name: /custom\/fake-1/ }).click();
      await expect(page.getByText(/No se pudo cambiar el modelo: Model update refused/)).toBeVisible();
      await expect(agentButton).toHaveText("custom/fake-2");
      await agentButton.click();
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
    await expect(page.locator(".mchoice").getByRole("status")).toContainText("La primera regla que coincida");
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
