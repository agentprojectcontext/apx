import type { Job, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["es-AR", "en-US"]) {
  test.describe(language, () => {
    test.use({ locale: language });
    test("a rejected shell command ends and Terminal explains that it could not start", async ({ page }, info) => {
      await rpc("setup.finish");
      const thread = await rpc<Thread>("threads.create", {
        kind: "loose",
        agent_id: "superagent",
        title: "Command start",
      });
      await rpc("threads.send", { thread: thread.id, text: "run a rejected command" });
      await expect
        .poll(async () => {
          const jobs = await rpc<{ finished: Job[] }>("jobs.list", { thread: thread.id, finished: 10 });
          return jobs.finished.find((j) => j.kind === "terminal")?.state;
        })
        .toBe("failed");
      const jobs = await rpc<{ running: Job[]; finished: Job[] }>("jobs.list", { thread: thread.id, finished: 10 });
      expect(jobs.running.filter((j) => j.kind === "terminal")).toHaveLength(0);
      const job = jobs.finished.find((j) => j.kind === "terminal");
      expect(job?.ended_at).toBeTruthy();
      expect(job?.start_error).toContain("null bytes");
      const label = language === "es-AR" ? "No se pudo iniciar" : "Could not start";
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, `#thread=${thread.id}&panel=processes`);
        const row = page.locator(".procs__row");
        await expect(row).toContainText(label);
        await row.click();
        await expect(page.locator(".procs__head")).toContainText(label);
        await expect(page.locator(".procs__out")).toContainText("null bytes");
        await expect(page.locator(".procs__view").getByRole("button")).toHaveCount(0);
        await info.attach(`terminal-${language}-${width}`, {
          body: await page.screenshot({ path: info.outputPath(`terminal-${language}-${width}.png`) }),
          contentType: "image/png",
        });
      }
    });
  });
}
