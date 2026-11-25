import fs from "node:fs";
import { saveUpload } from "../../apps/core/src/services/uploads.ts";
import { readingFixture } from "../../apps/core/src/tools/contact-project-reading.test-support.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`stickers keep their picture and caption without internal metadata at ${width}px`, async ({ page }, info) => {
    const h = await readingFixture(undefined, { port: 0 });
    try {
      await h.env.client.call("setup.finish", {});
      h.store.settings.write("channels", [
        {
          id: "test",
          type: "telegram",
          label: "Delivery line",
          enabled: false,
          agent_id: h.agent.id,
          strangers: "ignore",
          concurrency: "queue",
          owner_thread: "home",
        },
      ]);
      const media = saveUpload(h.env.home, h.store, {
        name: "sticker.png",
        mime: "image/png",
        bytes: fs.readFileSync(new URL("../../apps/web/src/assets/logo.png", import.meta.url)),
        thread: h.thread.id,
      });
      const wrap = (note: string) => `<sticker named_by="a model that saw it" trust="untrusted">\n${note}\n</sticker>`;
      const raw = wrap("[sticker: A friendly mascot]");
      for (const text of [raw, `Hello there\n${wrap("[sticker (18+): A cartoon]")}`]) {
        h.store.messages.add({
          thread_id: h.thread.id,
          author: { kind: "person", id: h.person.id, name: h.person.name, channel: "test" },
          parts: [
            { type: "image", media_id: media.id, mime: "image/png", alt: "" },
            { type: "text", text },
          ],
        });
      }
      h.store.threads.patch(h.thread.id, { preview: raw.slice(0, 160) });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
      await expect(page.locator(".chan__text")).toHaveText(["Hello there"]);
      await expect(page.locator(".chan__bubble")).toHaveCount(2);
      await expect(page.locator("body")).not.toContainText("named_by");
      await expect(page.locator("body")).not.toContainText('trust="untrusted"');
      await page.screenshot({ path: info.outputPath(`channel-${width}.png`) });
      await page.goto(`${h.env.core.url}/#thread=${h.thread.id}`);
      await expect(page.getByText("Hello there", { exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("named_by");
      await expect(page.locator("body")).not.toContainText("[sticker (18+):");
      await page.screenshot({ path: info.outputPath(`inbox-${width}.png`) });
      const kept = await h.env.client.call("threads.get", { thread: h.thread.id });
      expect(kept.thread.preview).toBe("[sticker: A friendly mascot]");
      expect(kept.messages.flatMap((m) => m.parts).some((p) => p.type === "text" && p.text === raw)).toBe(true);
    } finally {
      if (!page.isClosed()) await page.goto("about:blank");
      await h.close();
    }
  });
}
