import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { withPanel } from "./testkit.ts";

for (const destination of ["agent", "home", "agent-return"] as const) {
  test(`a late first-message response preserves the selected ${destination} and its draft`, async () => {
    await withPanel("en", false, async ({ client, page, frame }) => {
      const project = (await client.call("projects.create", { name: "Northwind" })).project;
      const other = (await client.call("projects.create", { name: "Acme" })).project;
      const alpha = await client.call("agents.create", { project_id: project.id, slug: "alpha", name: "Alpha" });
      const beta = await client.call("agents.create", { project_id: other.id, slug: "beta", name: "Beta" });
      await frame.locator("input").fill((await client.call("devices.pair_start", {})).code);
      await frame.locator('button[type="submit"]').click();
      const picker = frame.getByRole("combobox", { name: "New chat", exact: true });
      const choose = async (name: string) => {
        await picker.click();
        await frame.locator(".apx-searchselect__input").fill(name);
        await frame.getByRole("option").first().click();
      };
      await choose(alpha.name);
      const release = Promise.withResolvers<void>();
      let created: string | undefined;
      // Registered for the whole test: unrouting after one use can strand the next request of the cross-origin frame.
      await page.route("**/rpc/threads.create", async (route) => {
        if (created) return route.continue();
        const response = await route.fetch();
        const body = (await response.json()) as { result: { id: string } };
        created = body.result.id;
        await release.promise;
        await route.fulfill({ response });
      });
      try {
        await frame.locator("textarea").fill("Message for Alpha only.");
        await frame.locator("textarea").press("Enter");
        await expect.poll(() => created, { timeout: 15000 }).toBeTruthy();
        if (destination === "home") await frame.getByRole("button", { name: "Back to Home" }).click();
        else {
          await choose(beta.name);
          if (destination === "agent-return") await choose(alpha.name);
        }
        const selectedName = await frame.locator(".quick__name").innerText();
        const selectedProject = await frame.locator(".quick__sub").innerText();
        await frame.locator("textarea").fill("Preserve my next draft.");
        const sent = page.waitForResponse((response) => response.url().endsWith("/rpc/threads.send"));
        release.resolve();
        await (await sent).finished();
        await frame
          .locator("body")
          .evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          );
        await expect(frame.locator(".quick__name")).toHaveText(selectedName);
        await expect(frame.locator(".quick__sub")).toHaveText(selectedProject);
        await expect(frame.locator("textarea")).toHaveValue("Preserve my next draft.");
        assert.ok(created);
        const stored = await client.call("threads.get", { thread: created });
        assert.equal(stored.thread.agent_ids[0], alpha.id);
        assert.equal(stored.thread.project_id, project.id);
        assert.ok(stored.messages.some((message) => JSON.stringify(message.parts).includes("Message for Alpha only.")));
        if (destination === "agent") {
          assert.equal(selectedName, beta.name);
          assert.equal(selectedProject, other.name);
        } else if (destination === "home") assert.equal(selectedProject, "Home");
        else {
          assert.equal(selectedName, alpha.name);
          assert.equal(selectedProject, project.name);
          await expect(frame.getByText("Message for Alpha only.", { exact: true })).toHaveCount(0);
          await frame.locator("textarea").press("Enter");
          await expect(frame.getByText("Preserve my next draft.", { exact: true })).toBeVisible();
          await expect
            .poll(async () => (await client.call("threads.list", { project_id: project.id })).threads.length)
            .toBe(2);
          const chats = (await client.call("threads.list", { project_id: project.id })).threads;
          const next = chats.find((chat) => chat.id !== created);
          assert.ok(next);
          assert.equal(next.agent_ids[0], alpha.id);
          const history = await client.call("threads.get", { thread: next.id });
          assert.ok(
            history.messages.some((message) => JSON.stringify(message.parts).includes("Preserve my next draft.")),
          );
          assert.ok(
            !history.messages.some((message) => JSON.stringify(message.parts).includes("Message for Alpha only.")),
          );
        }
      } finally {
        release.resolve();
      }
    });
  });
}

for (const surface of ["quick", "panel"] as const) {
  test(`/new opens a fresh ${surface} chat and sends without the previous conversation`, async () => {
    await withPanel("en", false, async ({ client, frame, page, core }) => {
      if (surface === "panel") {
        await client.call("setup.finish", {});
        const url = `${core.url}/#thread=home`;
        const navigated = page.waitForEvent("framenavigated", { predicate: (frame) => frame.url() === url });
        await page.locator("iframe").evaluate((element, url) => {
          element.setAttribute("src", url);
        }, url);
        await navigated;
      }
      await frame.locator("input").fill((await client.call("devices.pair_start", {})).code);
      await frame.locator('button[type="submit"]').click();
      const box = frame.locator("textarea");
      const reply = frame.getByText("The isolated chat reached APX.", { exact: true });
      await box.fill("Only in the original conversation.");
      await box.press("Enter");
      await expect(reply).toBeVisible({ timeout: 30000 });
      const previous = await client.call("threads.get", { thread: "home" });
      await box.fill("/new");
      await expect(frame.locator(".slash__row.is-active .slash__name")).toHaveText("/new");
      await box.press("Enter");
      await expect(box).toBeEmpty();
      await expect(reply).toHaveCount(0);
      await box.fill("Only in the new conversation.");
      await box.press("Enter");
      await expect(reply).toBeVisible({ timeout: 30000 });
      const made = (await client.call("threads.list", {})).threads.filter((thread) => thread.id !== "home");
      assert.equal(made.length, 1);
      const fresh = await client.call("threads.get", { thread: made[0]?.id ?? "" });
      assert.ok(
        fresh.messages.some((message) => JSON.stringify(message.parts).includes("Only in the new conversation.")),
      );
      assert.ok(
        !fresh.messages.some((message) => JSON.stringify(message.parts).includes("Only in the original conversation.")),
      );
      assert.equal((await client.call("threads.get", { thread: "home" })).messages.length, previous.messages.length);
    });
  });
}
