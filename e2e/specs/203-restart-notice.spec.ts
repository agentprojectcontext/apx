import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`a restart that cut a turn is one quiet system line, with no agent name or controls (${width})`, async ({
    page,
  }, info) => {
    const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Listo, lo reviso.")) });
    try {
      await env.client.call("setup.finish", {});
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
      await page.goto(`${env.core.url}/#thread=${chat.id}`);
      await env.client.call("threads.send", { thread: chat.id, text: "Revisá el informe" });
      await env.settle(chat.id);
      const agent = env.core.store.messages.list(chat.id).find((m) => m.author.kind === "agent");
      if (!agent) throw new Error("the agent did not answer");
      const cut = (code: "run.resumed" | "run.interrupted", text: string) =>
        env.core.store.messages.add({
          thread_id: chat.id,
          author: agent.author,
          run_id: agent.run_id,
          parts: [{ type: "notice", level: "warn", code, text }],
        });
      // A turn resumed after a restart and cut by the next one: the line is said once, by the latest.
      cut("run.resumed", "Interrupted by a restart of APX; picking it back up.");
      cut("run.interrupted", "Interrupted by a restart of APX.");
      await page.reload();

      const transcript = page.locator(".transcript");
      await expect(transcript).toContainText("Listo, lo reviso.");
      const lines = transcript.locator(".noticeline");
      await expect(lines).toHaveCount(1);
      await expect(lines).toHaveText("Se interrumpió por un reinicio de APX.");
      // A system line: not the agent's message, so no name, no model and no buttons under it.
      const row = transcript.locator(".transcript__row", { has: lines });
      await expect(row.getByRole("button")).toHaveCount(0);
      await expect(row.locator(".apx-msgmeta")).toHaveCount(0);
      await expect(row.locator(".noticeline.is-warn")).toHaveCount(0);

      // After the owner writes again, a new restart is a new line.
      await env.client.call("threads.send", { thread: chat.id, text: "Seguí" });
      await env.settle(chat.id);
      cut("run.resumed", "Interrupted by a restart of APX; picking it back up.");
      await page.reload();
      await expect(transcript.locator(".noticeline")).toHaveCount(2);
      await expect(transcript.locator(".noticeline").last()).toHaveText(
        "Se interrumpió por un reinicio de APX; lo retomo.",
      );
      await page.screenshot({ path: info.outputPath(`restart-notice-${width}.png`) });
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
