import fs from "node:fs";
import { inboundFiles } from "../apps/core/src/channels/inbound-files.ts";
import { quietMessage } from "../apps/core/src/channels/quiet-message.ts";
import { saveUpload } from "../apps/core/src/services/uploads.ts";
import { readingFixture } from "../apps/core/src/tools/contact-project-reading.test-support.ts";

const stickerEnvelope = (note: string) =>
  `<sticker named_by="a model that saw it" trust="untrusted">\n${note}\n</sticker>`;
export const literalCaption = "[sticker: examples] and [notes]";

export async function stickerFixture() {
  const h = await readingFixture(undefined, { port: 0 });
  try {
    await h.env.client.call("setup.finish", {});
    const configs = [
      ["test", "Delivery line"],
      ["cut-open", "Partial opening"],
      ["cut-close", "Partial closing"],
      ["literal", "Literal text"],
      ["literal-cap", "Capped literal"],
      ["cut-short", "Short opening"],
      ["literal-short", "Short literal"],
      ["literal-named", "Named literal"],
      ["literal-named-cap", "Capped named literal"],
      ["cut-named", "Cut named opening"],
    ] as const;
    h.store.settings.write(
      "channels",
      configs.map(([id, label]) => ({
        id,
        type: "telegram",
        label,
        enabled: false,
        agent_id: h.agent.id,
        strangers: "ignore",
        concurrency: "queue",
        owner_thread: "home",
      })),
    );
    const media = saveUpload(h.env.home, h.store, {
      name: "sticker.png",
      mime: "image/png",
      bytes: fs.readFileSync(new URL("../apps/web/src/assets/logo.png", import.meta.url)),
      thread: h.thread.id,
    });
    const adult = h.store.stickers.add({ platform: "telegram", hash: "adult-fixture", media_id: media.id });
    h.store.stickers.describe(adult.id, "A cartoon");
    h.store.stickers.review(adult.id, { adult: true, pending: true });
    const keep = quietMessage(h.store);
    for (const caption of ["", "[sticker]", "Human caption"]) {
      const attachments: string[] = [];
      const saved = await inboundFiles(
        { home: h.env.home, store: h.store, stickers: { keep: async () => undefined } },
        "telegram",
        h.thread.id,
        [{ name: "sticker.png", mime: "image/png", data: fs.readFileSync(media.path).toString("base64"), sticker: {} }],
        true,
        caption,
        attachments,
      );
      keep(h.thread.id, "test", h.person, saved.text, attachments, undefined, { attachmentNotes: saved.notes });
    }
    keep(h.thread.id, "test", h.person, "[sticker]", [media.id]);
    const raw = stickerEnvelope("[sticker: A friendly mascot]");
    const messages = [
      [raw, true],
      [`Hello there\n${stickerEnvelope("[sticker (18+): A cartoon]")}`, true],
      [`${literalCaption}\n${raw}`, true],
      [`[sticker: fox]\n${stickerEnvelope("[sticker (18+): A cartoon]")}`, true],
      [stickerEnvelope("[sticker: Missing picture]"), false],
      [`Multiple stickers\n${raw}\n${stickerEnvelope("[sticker (18+): A cartoon]")}`, true],
    ] as const;
    for (const [text, attached] of messages) {
      h.store.messages.add({
        thread_id: h.thread.id,
        author: { kind: "person", id: h.person.id, name: h.person.name, channel: "test" },
        parts: [
          ...(attached ? [{ type: "image" as const, media_id: media.id, mime: "image/png", alt: "" }] : []),
          { type: "text", text },
        ],
      });
    }
    h.store.threads.patch(h.thread.id, { preview: raw.slice(0, 160) });
    const close = raw.indexOf("</sticker>");
    const previews = [
      `${"x".repeat(154)}\n<stic`,
      raw.slice(0, close + 1),
      "Literal <stic and <",
      `${"y".repeat(154)}\n<stic`,
      "<stic",
      "<stic",
      '<sticker named_by="',
      `${"z".repeat(140)}\n<sticker named_by="`,
      '<sticker named_by="',
    ];
    for (const [i, preview] of previews.entries()) {
      const cfg = configs[i + 1];
      if (!cfg) throw new Error("Missing preview account");
      const thread = h.store.threads.create({
        kind: "channel",
        title: cfg[1],
        agent_ids: [h.agent.id],
        project_id: h.project.id,
        channel: { id: cfg[0], conversation: cfg[0], person_id: h.person.id },
      });
      const source = i === 0 ? `${"x".repeat(154)}\n${raw}` : i === 1 || i === 4 || i === 8 ? raw : preview;
      h.store.messages.add({
        thread_id: thread.id,
        author: { kind: "person", id: h.person.id, name: h.person.name, channel: cfg[0] },
        parts: [{ type: "text", text: source }],
      });
      h.store.threads.patch(thread.id, { preview });
    }
    return { ...h, info: { url: h.env.core.url, thread: h.thread.id, raw, home: h.env.home } };
  } catch (error) {
    await h.close();
    throw error;
  }
}
