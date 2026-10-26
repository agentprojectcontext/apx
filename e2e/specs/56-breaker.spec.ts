// The spend breaker: the owner writing over Telegram renews the agents' budget like writing in the app, and a
// delegation it refuses shows the owner the pause in the chat, with the ways to let agents go on.
import { expect, open, rpc, test, until, world } from "./kit.ts";

/** Linked as the owner's Telegram account in 06-telegram. */
const owner = { id: 4242, name: "Ana" };

type Thread = { id: string; title: string };
const workerSessions = async () =>
  (await rpc<{ threads: Thread[] }>("threads.list", { include_subthreads: true })).threads.filter((t) =>
    t.title.includes("→ Researcher: check the sources"),
  ).length;

test.afterEach(async () => {
  await rpc("agents.set_limits", { runs: 30, tokens: 1_500_000 });
});

test("the owner writing on Telegram gives agents a fresh budget each time", async () => {
  await rpc("agents.set_limits", { runs: 1, tokens: 0 });
  const before = await workerSessions();
  await world.telegram(owner, "start a worker for the first source");
  await until(async () => (await workerSessions()) === before + 1);
  await until(async () =>
    (await world.sentTo(owner.id)).some((m) => m.text?.includes("Got it: start a worker for the first source")),
  );
  // One unattended turn spent: only the owner's new message lets the next delegation run.
  await world.telegram(owner, "start a worker for the second source");
  await until(async () => (await workerSessions()) === before + 2);
});

for (const mode of ["reset", "release"] as const) {
  test(`${mode} resumes paused work and keeps the notice resolved after navigation and reload`, async ({ page }) => {
    await rpc("agents.set_limits", { runs: 1, tokens: 0 });
    const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby" });
    await open(page, `#thread=${chat.id}`);
    const main = page.getByRole("main");
    const composer = main.getByRole("textbox").last();
    await composer.fill("start two workers");
    await composer.press("Enter");

    const notice = main.getByRole("status").filter({ hasText: "Researcher empieza «check the sources»" });
    await expect(notice).toContainText("En pausa: los agentes hicieron 1 turnos solos");
    await expect(notice.getByRole("button", { name: "Liberar en esta ronda" })).toBeVisible();
    const llmCalls = await world.llmCalls();
    await notice
      .getByRole("button", {
        name: mode === "reset" ? "Reiniciar presupuesto" : "Liberar en esta ronda",
      })
      .click();
    await expect(notice.getByText("Los agentes siguieron")).toBeVisible();
    // Going on gives the agent that was refused a turn of its own, without the owner typing.
    await until(async () => (await world.llmCalls()) > llmCalls);

    await open(page, "#thread=home");
    await open(page, `#thread=${chat.id}`);
    await expect(notice.getByText("Los agentes siguieron")).toBeVisible();
    await expect(notice.getByRole("button", { name: "Liberar en esta ronda" })).toHaveCount(0);
    await page.reload();
    await expect(notice.getByText("Los agentes siguieron")).toBeVisible();
    await expect(notice.getByRole("button", { name: "Reiniciar presupuesto" })).toHaveCount(0);
  });
}
