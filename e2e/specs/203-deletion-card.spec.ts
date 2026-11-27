// A deletion card says what goes in plain words, leaves the reason to the agent's message, and folds the command away.
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const CLEANUP =
  "git -C .worktrees/local-auth restore --worktree -- Dockerfile LICENSE pnpm-lock.yaml && git worktree remove .worktrees/local-auth && git branch -d fix/local-auth";

const deletion = test.extend<{ deletionCore: Awaited<ReturnType<typeof startCore>> }>({
  deletionCore: async ({ baseURL: _baseURL }, use) => {
    const env = await startCore({
      port: 0,
      llm: scriptedLlm((_, { afterTool }) =>
        afterTool
          ? say("Left as it was.")
          : {
              message: {
                role: "assistant",
                content: "The local-auth branch is merged; I'm removing its work folder and branch.",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "shell", arguments: JSON.stringify({ command: CLEANUP }) },
                  },
                ],
              },
            },
      ),
    });
    try {
      await use(env);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  },
});

deletion("a deletion card lists what goes and folds the command", async ({ page, deletionCore: env }, info) => {
  try {
    await env.client.call("setup.finish", {});
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Limpieza",
    });
    await env.client.call("threads.send", { thread: chat.id, text: "clean up local-auth" });
    await expect.poll(async () => (await env.client.call("runs.pending", { thread: chat.id })).inputs.length).toBe(1);
    await page.goto(`${env.core.url}/#thread=${chat.id}`);

    const card = page.locator(".inputcard.is-pending");
    const items = card.locator(".inputcard__gone li");
    await expect(items).toHaveText([
      "Cambios sin guardar en 3 archivos de .worktrees/local-auth (Dockerfile, LICENSE, pnpm-lock.yaml)",
      "La carpeta de trabajo .worktrees/local-auth (git no la borra si tiene cambios sin guardar)",
      "La rama fix/local-auth (git no la borra si tiene trabajo sin mergear)",
    ]);
    // Its reason is the message just above, not said twice.
    await expect(
      page.getByText("The local-auth branch is merged; I'm removing its work folder and branch."),
    ).toHaveCount(1);
    await expect(card.locator(".inputcard__reason")).toHaveCount(0);
    await expect(card).not.toContainText("/Volumes");
    const toggle = card.getByRole("button", { name: "Ver comando" });
    const command = card.getByText(CLEANUP, { exact: true });
    for (const [width, layout] of [
      [1280, "desktop"],
      [390, "phone"],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload();
      await expect(items).toHaveCount(3);
      await expect(command).toBeHidden();
      await card.scrollIntoViewIfNeeded();
      for (const shot of ["folded", "command"] as const) {
        if (shot === "command") {
          await toggle.click();
          await expect(command).toBeVisible();
        }
        const file = info.outputPath(`deletion-card-${layout}-${shot}.png`);
        await page.screenshot({ path: file, animations: "disabled" });
        await info.attach(`deletion-card-${layout}-${shot}`, { path: file, contentType: "image/png" });
      }
    }
    await card.getByRole("button", { name: "Rechazar" }).click();
    await expect(page.locator(".inputcard.is-pending")).toHaveCount(0);
  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
  }
});
