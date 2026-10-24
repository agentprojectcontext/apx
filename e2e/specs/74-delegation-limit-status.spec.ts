import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("a limit notice follows live work, continues only a stopped session, and stays current after reload", async ({
  page,
}) => {
  let release = Promise.withResolvers<void>();
  const env = await startCore({
    port: Number(process.env.E2E_PORT ?? 7460) + 4,
    llm: scriptedLlm(async (req, { said }) => {
      if (said.includes("trabajo pendiente")) {
        await Promise.race([
          release.promise,
          new Promise<void>((_, reject) =>
            req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true }),
          ),
        ]);
      }
      return say("Remaining checks finished.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    const { store } = env.core;
    const root = store.threads.create({ kind: "loose", title: "Northwind review", agent_ids: ["roby"] });
    const parent = store.runs.create({
      thread_id: root.id,
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "Review" },
      deadline_at: new Date().toISOString(),
    });
    store.runs.setState(parent, "completed", undefined, { reason: "normal" });
    const sub = store.threads.create({
      kind: "a2a",
      title: "Check sources",
      agent_ids: ["roby"],
      parent_id: root.id,
      session: "research",
    });
    const first = store.runs.create({
      thread_id: sub.id,
      agent_id: "roby",
      trigger: "a2a",
      parent_run_id: parent.id,
      depth: 1,
      input: {
        origin: { kind: "agent", id: "roby", name: "Roby", thread_id: root.id, run_id: parent.id },
        text: "Check sources",
      },
      deadline_at: new Date().toISOString(),
    });
    store.runs.setState(first, "completed", undefined, { reason: "step_limit" });
    store.messages.add({
      thread_id: root.id,
      author: { kind: "system" },
      parts: [
        {
          type: "notice",
          level: "warn",
          code: "delegation.limit",
          text: "Stopped at the step limit.",
          vars: {
            variant: "continuedSteps",
            who: "Researcher",
            task: "Check sources",
            session: "research",
            caller: "Roby",
            sofar: "Sources found.",
            subthread: sub.id,
          },
        },
      ],
    });
    await page.goto(`${env.core.url}/#thread=${root.id}`);
    const notice = page.locator(".noticeline").filter({ hasText: "Researcher" });
    await expect(notice.getByText("Detenida", { exact: true })).toBeVisible();
    await expect(notice.getByRole("button", { name: "Detenerla" })).toHaveCount(0);

    await notice.getByRole("button", { name: "Abrir sesión" }).click();
    await expect(page.getByRole("complementary", { name: "Panel lateral" })).toContainText("Check sources");
    expect(store.runs.list(sub.id)).toHaveLength(1);
    const failure = Promise.withResolvers<void>();
    let requests = 0;
    await page.route("**/rpc/threads.send", async (route) => {
      requests++;
      await failure.promise;
      await route.fulfill({
        status: 200,
        json: { ok: false, error: { code: "conflict", message: "Session changed; retry" } },
      });
    });
    await notice.getByRole("button", { name: "Continuar", exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(notice.getByRole("button", { name: "Continuando…", exact: true })).toBeDisabled();
    failure.resolve();
    await expect(page.getByText("Session changed; retry", { exact: true })).toBeVisible();
    await expect(notice.getByRole("button", { name: "Continuar", exact: true })).toBeEnabled();
    expect(requests).toBe(1);
    expect(store.runs.list(sub.id)).toHaveLength(1);
    await page.unroute("**/rpc/threads.send");
    await notice.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(notice.getByText("Sigue trabajando", { exact: true })).toBeVisible();
    await expect(notice.getByRole("button", { name: "Continuar", exact: true })).toHaveCount(0);
    expect(store.runs.list(sub.id)).toHaveLength(2);
    expect(store.runs.list(sub.id)[0]?.parent_run_id).toBe(parent.id);

    await page.reload();
    await expect(notice.getByText("Sigue trabajando", { exact: true })).toBeVisible();
    await notice.getByRole("button", { name: "Detenerla" }).click();
    await expect(notice.getByText("Detenida", { exact: true })).toBeVisible();
    await expect(notice.getByRole("button", { name: "Continuar", exact: true })).toBeEnabled();

    release = Promise.withResolvers<void>();
    await notice.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(notice.getByText("Sigue trabajando", { exact: true })).toBeVisible();
    release.resolve();
    await expect(notice.getByText("Terminó", { exact: true })).toBeVisible();
    await expect(notice.getByRole("button", { name: "Continuar", exact: true })).toHaveCount(0);
    await expect(notice.getByRole("button", { name: "Detenerla" })).toHaveCount(0);
    expect(store.runs.list(sub.id)).toHaveLength(3);
  } finally {
    release.resolve();
    // Detach the browser before stopping its server so reconnects cannot race fixture cleanup.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
