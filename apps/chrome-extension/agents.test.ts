import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { capture, LONG_MODEL, withPanel } from "./testkit.ts";

for (const language of ["en", "es"] as const) {
  test(`${language}: new chat searches agents and projects without carrying another chat's model`, async () => {
    await withPanel(language, false, async ({ client, page, frame, llm, stopCore, restartCore }) => {
      const project = (await client.call("projects.create", { name: "Northwind" })).project;
      const other = (await client.call("projects.create", { name: "Acme" })).project;
      const agent = await client.call("agents.create", {
        project_id: project.id,
        slug: "developer",
        name: "Developer",
        role: "Product engineer",
      });
      const peer = await client.call("agents.create", {
        project_id: other.id,
        slug: "developer",
        name: "Developer",
        role: "Product engineer",
      });
      await client.call("agents.update", {
        agent: agent.id,
        model_choice: { model: "custom/sample-one", router: false },
      });
      await client.call("agents.update", {
        agent: peer.id,
        model_choice: { model: `custom/${LONG_MODEL}`, router: false },
      });
      const secretary = (await client.call("agents.list", {})).agents.find((a) => a.kind === "secretary");
      assert.ok(secretary);
      const baseline = (await client.call("threads.list", {})).threads.map((thread) => thread.id);
      await frame.locator("input").fill((await client.call("devices.pair_start", {})).code);
      await frame.locator('button[type="submit"]').click();
      const model = frame.locator(".composer__model");
      await expect(model).toContainText("sample-one");
      await model.click();
      await frame.getByRole("option", { name: new RegExp(LONG_MODEL) }).click();
      await page.keyboard.press("Escape");
      await frame.locator("textarea").fill("Keep this draft.");
      const newChat = frame.getByRole("combobox", { name: language === "es" ? "Nuevo chat" : "New chat", exact: true });
      await newChat.click();
      const search = frame.locator(".apx-searchselect__input");
      await expect(search).toBeFocused();
      await expect(frame.getByRole("option", { name: new RegExp(secretary.name) }).first()).toBeVisible();
      await capture(page, frame, language, "agent-picker");
      await search.fill("No matching agent");
      await expect(frame.getByRole("option")).toHaveCount(0);
      await expect(frame.locator(".apx-searchselect__empty")).toHaveText(
        language === "es" ? "Sin resultados" : "No results",
      );
      await capture(page, frame, language, "agent-no-match");
      await page.keyboard.press("Escape");
      await expect(newChat).toBeFocused();
      await expect(frame.locator("textarea")).toHaveValue("Keep this draft.");
      await newChat.click();
      await expect(search).toBeVisible();
      await frame.locator("textarea").click();
      await expect(search).toBeHidden();
      await expect(frame.locator("textarea")).toHaveValue("Keep this draft.");
      assert.deepEqual(
        (await client.call("threads.list", {})).threads.map((thread) => thread.id),
        baseline,
      );
      await newChat.click();
      await search.fill("Northwind");
      await expect(frame.getByRole("option")).toHaveCount(1);
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(frame.locator(".quick__name")).toHaveText(agent.name);
      await expect(frame.locator(".quick__sub")).toHaveText(project.name);
      await expect(frame.locator("textarea")).toBeEmpty();
      await expect(model).toContainText("sample-one");
      await expect(model).not.toContainText(LONG_MODEL);
      assert.deepEqual(
        (await client.call("threads.list", {})).threads.map((thread) => thread.id),
        baseline,
      );
      await capture(page, frame, language, "agent-selected");
      await model.click();
      await frame.getByRole("option", { name: new RegExp(LONG_MODEL) }).click();
      await page.keyboard.press("Escape");
      await frame.locator("textarea").fill("Check the project agent.");
      await frame.locator("textarea").press("Enter");
      await expect(frame.getByText("The isolated chat reached APX.", { exact: true })).toBeVisible({ timeout: 30000 });
      const made = (await client.call("threads.list", { project_id: project.id })).threads;
      assert.equal(made.length, 1);
      assert.equal(made[0]?.agent_ids[0], agent.id);
      assert.equal(made[0]?.project_id, project.id);
      assert.equal(made[0]?.model_choice?.model, `custom/${LONG_MODEL}`);
      assert.ok(llm.calls.some((call) => call.models.includes(`custom/${LONG_MODEL}`)));
      assert.equal(
        (await client.call("agents.list", {})).agents.find((a) => a.id === agent.id)?.model_choice?.model,
        "custom/sample-one",
      );
      await newChat.click();
      await expect(frame.getByRole("option").first()).toContainText("Northwind");
      await search.fill("Northwind");
      await expect(frame.getByRole("option")).toHaveCount(2);
      await capture(page, frame, language, "agent-recent");
      await search.fill(secretary.name);
      await frame
        .getByRole("option", { name: new RegExp(secretary.name) })
        .first()
        .click();
      await expect(frame.locator(".quick__name")).toHaveText(secretary.name);
      await expect(model).toContainText("sample-one");
      await expect(model).not.toContainText(LONG_MODEL);
      await newChat.click();
      await search.fill("Acme");
      await frame.getByRole("option").click();
      await expect(frame.locator(".quick__sub")).toHaveText(other.name);
      await expect(model).toContainText(LONG_MODEL);
      await stopCore();
      await expect(newChat).toBeDisabled();
      await expect(frame.locator(".quick__offline")).toBeVisible();
      await capture(page, frame, language, "agent-offline");
      await restartCore();
      await expect(newChat).toBeEnabled({ timeout: 15000 });
      await expect(frame.locator(".quick__sub")).toHaveText(other.name);
      await expect(model).toContainText(LONG_MODEL);
    });
  });
}
