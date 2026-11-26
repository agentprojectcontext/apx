import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`what the agent saves or adds to research shows as small chips that unfold, and a summary as a short one (${width})`, async ({
    page,
  }, info) => {
    const env = await startCore({
      port: 0,
      llm: scriptedLlm((_req, { said, afterTool }) => {
        if (afterTool) return say("¡Buenísimo! Te aviso si sale algo de fotografía analógica en Córdoba.");
        if (said.includes("fotografía"))
          return {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                ...(callTool("m", "remember", { text: "Le gusta la fotografía analógica." }).message.tool_calls ?? []),
                ...(callTool("r", "apx_settings", {
                  method: "discovery.add",
                  params: { interests: ["Fotografía analógica"], location: "Córdoba" },
                }).message.tool_calls ?? []),
              ],
            },
          };
        return say("ok");
      }),
    });
    try {
      await env.client.call("setup.finish", {});
      await env.client.call("discovery.configure", { enabled: true });
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
      await page.goto(`${env.core.url}/#thread=${chat.id}`);
      await env.client.call("threads.send", {
        thread: chat.id,
        text: "Me encanta la fotografía analógica, vivo en Córdoba",
      });
      await env.settle(chat.id);
      // The chat was summarized before the next turn: one short line, nothing to open.
      env.core.store.messages.add({
        thread_id: chat.id,
        author: { kind: "system" },
        parts: [
          {
            type: "notice",
            level: "info",
            code: "thread.compacted",
            text: "Summarized 12 earlier turns to keep this chat's context small. Nothing new was started.",
          },
        ],
      });
      await page.reload();
      const transcript = page.locator(".transcript");
      await expect(transcript).toContainText("Te aviso si sale algo");

      const memory = transcript.locator(".turn__chip", { hasText: "Se guardó en memoria" });
      const research = transcript.locator(".turn__chip", { hasText: "Se actualizó la investigación" });
      await expect(memory).toHaveCount(1);
      await expect(research).toHaveCount(1);
      // The steps they stand for are not listed again among the turn's steps.
      await expect(transcript.locator(".turn__tools:not(.turn__chip)")).toHaveCount(0);

      await expect(memory).not.toContainText("Le gusta la fotografía analógica.");
      await page.screenshot({ path: info.outputPath(`chips-folded-${width}.png`) });
      await memory.getByRole("button", { name: "Se guardó en memoria" }).click();
      await expect(memory).toContainText("Le gusta la fotografía analógica.");
      await research.getByRole("button", { name: "Se actualizó la investigación" }).click();
      await expect(research).toContainText("Interés: Fotografía analógica");
      await expect(research).toContainText("Lugar: Córdoba");

      const summary = transcript.locator(".noticeline", { hasText: "Se resumió la charla" });
      await expect(summary).toHaveCount(1);
      await expect(summary).not.toContainText("turnos");
      await expect(summary.locator(".apx-actions__chevron")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`chips-${width}.png`) });
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
