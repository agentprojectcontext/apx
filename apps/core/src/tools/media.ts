// make_image: an agent draws with the owner's image services and the image appears in the chat. voice_replies: its
// answers on a channel also go as voice notes.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { channelsOn } from "./directory.ts";
import { documentTool } from "./documents.ts";
import { readsOutside } from "./folders.ts";
import { defineTool, type Tool } from "./types.ts";

/** A media id APX gave out (an earlier drawing), not a file path. */
const MEDIA_ID = /^med_[0-9a-f]{16}$/;

export function mediaTools(store: Store, home: string, vm?: { hasThread(id: string): boolean }): Tool[] {
  return [
    documentTool(store, home),
    defineTool({
      name: "send_file",
      description:
        "Attach an existing file you can read directly to your reply in this chat. Use when the owner asks to see or download a file, image, video, audio or document here. Images appear inline; videos play in the chat; files can be downloaded. Path relative to your work folder, or absolute; maximum 20 MB per file. Call once per file; a website link is no substitute.",
      args: z.object({ path: z.string().trim().min(1).max(1000) }),
      // Only to this chat, the owner's: contacts and rooms never get it (CONTACT_TOOLS).
      effect: "local",
      outside: (a, ctx) => readsOutside(store, home, ctx.thread, [String(a.path)]),
      deadlineMs: 15_000,
      title: (a) =>
        `Attached ${String(a.path ?? "a file")
          .split(/[\\/]/)
          .at(-1)}`,
      async run(a, ctx) {
        const { media: m } = await ctx.call("media.attach", { path: a.path });
        const part =
          m.kind === "image"
            ? { type: "image" as const, media_id: m.id, mime: m.mime, alt: m.name }
            : { type: "file" as const, media_id: m.id, mime: m.mime, name: m.name, bytes: m.bytes };
        ctx.upsertPart((p) => (p.type === "image" || p.type === "file") && p.media_id === m.id, part);
        return `Attached ${m.name} (${m.mime}, ${m.bytes} bytes) in this chat.`;
      },
    }),
    defineTool({
      name: "voice_replies",
      description:
        "Turn spoken answers on or off for this chat: on a channel like Telegram your answers then also arrive as voice notes. Use it when the owner asks to hear you (or to stop).",
      args: z.object({ on: z.boolean() }),
      effect: "local",
      when: () => channelsOn(store),
      deadlineMs: 5_000,
      title: (a) => (a.on ? "Turned on spoken answers" : "Turned off spoken answers"),
      async run(a, ctx) {
        await ctx.call("threads.voice", { thread: ctx.thread.id, on: a.on });
        return a.on ? "spoken answers on for this chat." : "spoken answers off for this chat.";
      },
    }),
    defineTool({
      name: "make_image",
      description:
        "Draw an image, shown in this chat; prompt in English. references: up to 4 images to work from (paths, e.g. an attachment or screenshot, or med_ ids of earlier drawings).",
      args: z.object({
        prompt: z.string().trim().min(3).max(2000),
        negative_prompt: z.string().max(1000).optional(),
        width: z.number().int().min(256).max(2048).optional(),
        height: z.number().int().min(256).max(2048).optional(),
        count: z.number().int().min(1).max(4).optional(),
        references: z.array(z.string().min(1)).max(4).optional(),
      }),
      effect: "external",
      when: () => store.settings.read("services").some((s) => s.kind === "image" && s.enabled),
      // On the computer a path names a file in the guest, which the core cannot read: only earlier drawings work there.
      check(a, ctx) {
        if (vm?.hasThread(ctx.thread.id) && (a.references ?? []).some((r) => !MEDIA_ID.test(r)))
          throw new Error("on the computer, references are med_ ids of earlier drawings, not file paths");
      },
      outside: (a, ctx) =>
        vm?.hasThread(ctx.thread.id)
          ? []
          : readsOutside(
              store,
              home,
              ctx.thread,
              ((a.references as string[] | undefined) ?? []).filter((r) => !MEDIA_ID.test(r)),
            ),
      deadlineMs: 11 * 60_000,
      title: (a) => `Drew: ${String(a.prompt ?? "").slice(0, 80)}`,
      async run({ references: refs, ...a }, ctx) {
        const references: string[] = [];
        for (const ref of refs ?? [])
          references.push(MEDIA_ID.test(ref) ? ref : (await ctx.call("media.attach", { path: ref })).media.id);
        const r = await ctx.call("media.image", {
          ...a,
          ...(references.length ? { references } : {}),
          thread: ctx.thread.id,
        });
        for (const m of r.media)
          ctx.upsertPart((p) => p.type === "image" && p.media_id === m.id, {
            type: "image",
            media_id: m.id,
            mime: m.mime,
            alt: a.prompt.slice(0, 200),
          });
        const note = r.skipped.length ? ` (skipped: ${r.skipped.join("; ")})` : "";
        const ids = r.media.map((m) => m.id).join(", ");
        return `${r.media.length} image(s) shown in the chat (${ids}), drawn by ${r.service}${r.model ? ` with ${r.model}` : ""}${note}.`;
      },
    }),
  ];
}
