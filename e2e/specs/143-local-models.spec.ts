// A model app running on this computer (Ollama-like, e2e/fake-local-models.ts) is found with no setup: its chat models
// show under Engines and models as free and local, an agent can run on one, and closed it stays listed, unavailable.
// The owner's Ollama imported from v1 sits at another address under "ollama", so the one found here is "ollama-local".
import type { Agent } from "../../packages/protocol/src/domain.ts";
import { expect, open, openSettings, rpc, test, world } from "./kit.ts";

test("a model app on this computer is found, picked for an agent and shown unavailable once closed", async ({
  page,
}, info) => {
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing secretary");
  const choiceOf = async () =>
    (await rpc<{ agents: Agent[] }>("agents.list")).agents.find((a) => a.id === agent.id)?.model_choice;
  try {
    await world.localModels(true);
    await open(page);
    await openSettings(page);
    const dialog = page.getByRole("dialog", { name: "Configuración", exact: true });
    await dialog.getByRole("navigation").getByRole("button", { name: "Motores y modelos" }).click();
    const row = dialog
      .locator(".catalog__engine")
      .filter({ has: page.locator(".catalog__id", { hasText: /^ollama-local$/ }) });
    await expect(row.locator(".catalog__summary .chip")).toHaveText("En tu equipo");
    await expect(row.locator(".catalog__meta")).toContainText("Gratis");
    await expect(row.getByText("Disponible")).toBeVisible();
    await row.locator("summary").click();
    await expect(row.getByText("llama3.2:3b", { exact: true })).toBeVisible();
    // Embedding models wait under the toggle with the voice and image ones.
    await expect(row.locator(".catalog__name", { hasText: "nomic-embed-text:latest" })).toHaveCount(0);
    await dialog.getByText("Mostrar también los de voz, imagen y embeddings").click();
    await expect(row.locator(".catalog__name", { hasText: "nomic-embed-text:latest" })).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("local-models-desktop.png") });

    // Picked for an agent like any provider model, and its chats go to the app.
    await dialog.getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
    await dialog.getByRole("button", { name: `Modelo de ${agent.name}`, exact: true }).click();
    const picker = page.locator(".mchoice");
    const option = picker.getByRole("option", { name: /ollama-local\/llama3\.2:3b/ });
    await expect(
      picker
        .locator(".mlist__group", { hasText: "ollama-local/llama3.2:3b" })
        .getByText("En tu equipo", { exact: true }),
    ).toBeVisible();
    await option.click();
    await expect.poll(choiceOf).toMatchObject({ model: "ollama-local/llama3.2:3b" });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const before = await world.localChats();
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("Hello from this computer");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.locator(".transcript").getByText("Got it: Hello from this computer")).toBeVisible();
    expect(await world.localChats()).toBeGreaterThan(before);

    // Closed, it stays listed with its models, unavailable, so the agent keeps its choice.
    await world.localModels(false);
    await openSettings(page);
    await dialog.getByRole("navigation").getByRole("button", { name: "Motores y modelos" }).click();
    await dialog.getByRole("button", { name: "Actualizar" }).click();
    await expect(row.getByText("No disponible")).toBeVisible();
    await expect(row.locator(".catalog__meta")).toContainText("Abrí Ollama para usarlos");
    await expect.poll(choiceOf).toMatchObject({ model: "ollama-local/llama3.2:3b" });

    await world.localModels(true);
    await dialog.getByRole("button", { name: "Actualizar" }).click();
    await expect(row.getByText("Disponible", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("local-models-phone.png") });
  } finally {
    await rpc("agents.update", { agent: agent.id, model_choice: agent.model_choice ?? null });
    await rpc("providers.set", { id: "ollama-local", provider: null });
    await world.localModels(false);
  }
});
