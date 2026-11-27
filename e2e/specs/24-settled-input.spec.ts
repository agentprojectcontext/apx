// An agent's request for the owner's OK: a card while it waits, one quiet line once answered (that opens on click).
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("an approved request shrinks to one line saying what was asked and how it ended", async ({ page }) => {
  await rpc("setup.finish", {});
  // In manual mode a command that changes something asks; Auto would run it unasked (DECISIONS.md#d-106).
  await rpc("agents.update", { agent: "scout", autonomy: "manual" });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Permisos" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("make a note file");
  await page.keyboard.press("Enter");

  const card = page.locator(".inputcard.is-pending");
  await expect(card).toContainText("Necesita tu OK");
  await expect(card).toContainText("usar shell");
  await card.getByRole("button", { name: "Aceptar una vez" }).click();
  await rpc("agents.update", { agent: "scout", autonomy: null });

  const line = page.locator(".inputline");
  await expect(line).toContainText("Pidió permiso para usar shell");
  await expect(line).toContainText("Aprobado");
  await expect(page.locator(".inputcard")).toHaveCount(0);
  // The actions' line (the tools group's design), folded until clicked.
  await expect(line).toHaveClass(/apx-actions/);
  await expect(line).not.toContainText("touch e2e-note.txt");
  await line.getByRole("button").click();
  await expect(line).toContainText("touch e2e-note.txt");
});

test("a question with several answers is ticked, then sent, and shows what was picked", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Días" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("ask me which days");
  await page.keyboard.press("Enter");

  const card = page.locator(".inputcard.is-pending");
  await expect(card).toContainText("Which days work for the Northwind review?");
  // The question is Markdown: bold reads as bold, never as asterisks.
  await expect(card.locator("strong")).toHaveText("Northwind");
  const send = card.getByRole("button", { name: "Enviar" });
  await expect(send).toBeDisabled();
  await card.getByRole("button", { name: "Monday" }).click();
  await card.getByRole("button", { name: "Wednesday" }).click();
  await expect(card.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "false");
  await send.click();

  await expect(page.locator(".inputline")).toContainText("Monday, Wednesday");
  await expect(page.locator(".inputcard")).toHaveCount(0);
});

const taskInput = test.extend<{ taskCore: Awaited<ReturnType<typeof startCore>> }>({
  taskCore: async ({ baseURL: _baseURL }, use) => {
    const env = await startCore({
      port: 0,
      llm: scriptedLlm((_, { afterTool }) =>
        afterTool
          ? say("Noted.")
          : callTool("dates", "ask_owner", {
              question: "Which days work for the Northwind review?",
              options: ["Monday", "Wednesday"],
              multi: true,
            }),
      ),
    });
    try {
      await use(env);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  },
  expectedConsoleErrors: async ({ taskCore }, use) => {
    await use([
      {
        path: `${taskCore.core.url}/rpc/runs.respond`,
        text: "Failed to load resource: the server responded with a status of 409 (Conflict)",
      },
    ]);
  },
});

taskInput(
  "a task question that expires during a tap stays in history without answer controls",
  async ({ page, taskCore: env }, info) => {
    try {
      await env.client.call("setup.finish", {});
      const task = await env.client.call("tasks.create", {
        title: "Draft review options",
        description: "Collect availability.",
        status: "doing",
        assignee: "superagent",
      });
      await expect.poll(async () => (await env.client.call("runs.pending", {})).inputs.length).toBe(1);
      const input = (await env.client.call("runs.pending", {})).inputs[0];
      if (!input) throw new Error("The assigned task did not ask a question");
      await page.goto(`${env.core.url}/#thread=${input.thread_id}`);
      const card = page.locator(".inputcard.is-pending");
      await card.getByRole("button", { name: "Monday" }).click();
      await page.route("**/rpc/runs.respond", async (route) => {
        await env.client.call("tasks.close", { task: task.id, state: "done" });
        await route.continue();
      });
      await card.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("Este pedido ya no está disponible.", { exact: true })).toBeVisible();
      const line = page.locator(".inputline");
      await expect(line).toContainText("Venció");
      await expect(card).toHaveCount(0);
      await expect(page.getByText(/Roby te espera/)).toHaveCount(0);
      await page.reload();
      await expect(line).toBeVisible();
      await line.getByRole("button").click();
      await expect(line).toContainText("Which days work for the Northwind review?");
      await info.attach("expired-card-desktop", { body: await page.screenshot(), contentType: "image/png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(line).toBeVisible();
      await expect(card).toHaveCount(0);
      await expect(page.getByText(/Roby te espera/)).toHaveCount(0);
      await info.attach("expired-card-narrow", { body: await page.screenshot(), contentType: "image/png" });
    } finally {
      if (!page.isClosed()) await page.goto("about:blank");
    }
  },
);
