import type { Page } from "@playwright/test";
import type { ActivityReviewRun, Task } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const DAY = 86_400_000;

/** Opens Settings › Review and improvements in the given language. */
async function openReview(page: Page, en: boolean) {
  await open(page);
  await page.getByRole("button", { name: en ? /^Account/ : /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: en ? /^Settings(?! wizard)/ : /^Configuración(?! inicial)/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en ? "Activity review" : "Revisión y mejoras", exact: true })
    .click();
}

/** The history the core answers, one page of it, while the rest of the screen talks to the real core. */
async function answerHistory(page: Page, pages: { runs: ActivityReviewRun[]; next?: string }[]) {
  const asked: unknown[] = [];
  await page.route("**/rpc/activity_review.history", async (route) => {
    const params = route.request().postDataJSON() as { before?: string };
    asked.push(params);
    const result = params.before ? pages[1] : pages[0];
    await route.fulfill({ json: { ok: true, result: result ?? { runs: [] } } });
  });
  return asked;
}

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    const en = language === "en";
    test.describe(`activity review history (${language}, ${width})`, () => {
      test.beforeEach(async ({ page }) => {
        await rpc("setup.finish");
        await rpc("activity_review.configure", { enabled: true, frequency: "daily", extra_details: "" });
        await page.setViewportSize({ width, height: width === 390 ? 760 : 900 });
        await page.addInitScript(
          (language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })),
          language,
        );
      });

      test("before any review, the history says what will show there", async ({ page }, info) => {
        await answerHistory(page, [{ runs: [] }]);
        await openReview(page, en);
        const history = page.getByRole("region", { name: en ? "History" : "Historial" });
        await expect(history).toContainText(
          en ? "Each review will show here: when it ran" : "Acá vas a ver cada revisión: cuándo se hizo",
        );
        await expect(history).toContainText(en ? "Next:" : "Próxima:");
        await history.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("history-empty.png") });
      });

      test("each review says when it ran, what it read and what became of each improvement", async ({ page }, info) => {
        const now = Date.now();
        const at = (days: number) => new Date(now - days * DAY).toISOString();
        const pending = await rpc<Task>("tasks.create", {
          title: en
            ? "Keep acceptance criteria visible in handoffs"
            : "Mantener visibles los criterios al pasar tareas",
          propose: true,
        });
        const done = await rpc<Task>("tasks.create", {
          title: en ? "Name the project in morning briefs" : "Nombrar el proyecto en los resúmenes de la mañana",
        });
        await rpc("tasks.close", { task: done.id, state: "done" });
        const asked = await answerHistory(page, [
          {
            runs: [
              {
                id: "arv_newest",
                at: at(0.1),
                since: at(7.1),
                state: "completed",
                chats: 12,
                messages: 30,
                proposals: [{ task_id: pending.id, title: pending.title, outcome: "pending" }],
              },
              {
                id: "arv_quiet",
                at: at(8),
                since: at(9),
                state: "completed",
                chats: 1,
                messages: 2,
                proposals: [],
              },
              {
                id: "arv_mixed",
                at: at(9),
                since: at(16),
                state: "completed",
                chats: 5,
                messages: 9,
                proposals: [
                  { task_id: done.id, title: done.title, outcome: "done" },
                  {
                    task_id: "tsk_gone",
                    title: en ? "Shorter replies on Telegram" : "Respuestas más cortas en Telegram",
                    outcome: "deleted",
                  },
                ],
              },
            ],
            next: at(9),
          },
          {
            runs: [
              {
                id: "arv_old",
                at: at(20),
                state: "completed",
                proposals: [
                  {
                    task_id: "tsk_old",
                    title: en ? "Group reminders by day" : "Agrupar recordatorios por día",
                    outcome: "dropped",
                  },
                ],
              },
            ],
          },
        ]);
        await openReview(page, en);
        const history = page.getByRole("region", { name: en ? "History" : "Historial" });
        const runs = history.getByRole("listitem");
        await expect(runs).toHaveCount(3);
        await expect(runs.nth(0)).toContainText(
          en ? "Read 12 chats from the last week" : "Leyó 12 charlas de la última semana",
        );
        await expect(runs.nth(0)).toContainText(en ? "To decide" : "Por decidir");
        await expect(runs.nth(1)).toContainText(en ? "Read 1 chat from the last day" : "Leyó 1 charla del último día");
        await expect(runs.nth(1)).toContainText(en ? "Nothing worth suggesting." : "No encontró nada para sugerir.");
        await expect(runs.nth(2)).toContainText(en ? "Done" : "Hecha");
        await expect(runs.nth(2)).toContainText(en ? "Deleted" : "Borrada");
        await expect(runs.nth(2).getByRole("button", { name: /Telegram/ })).toHaveCount(0);
        const content = page.locator(".config__content");
        expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await history.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("history.png") });
        await history.getByRole("button", { name: en ? "Show earlier reviews" : "Ver revisiones anteriores" }).click();
        await expect(runs).toHaveCount(4);
        await expect(runs.nth(3)).toContainText(
          en ? "Before the history started" : "Antes de que empezara el historial",
        );
        await expect(runs.nth(3)).toContainText(en ? "Dropped" : "Descartada");
        await expect(
          history.getByRole("button", { name: en ? "Show earlier reviews" : "Ver revisiones anteriores" }),
        ).toHaveCount(0);
        expect(asked).toEqual([{ limit: 10 }, { limit: 10, before: at(9) }]);
        await history.getByRole("button", { name: new RegExp(pending.title) }).click();
        await expect(page.getByRole("dialog", { name: en ? "Settings" : "Configuración" })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: pending.title })).toBeVisible();
        await page.screenshot({ path: info.outputPath("opened-task.png") });
        await rpc("tasks.delete", { task: pending.id });
        await rpc("tasks.delete", { task: done.id });
      });
    });
  }
}
