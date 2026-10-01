// make_image: an agent draws with the owner's image services and the image appears in the chat. voice_replies: its
// answers on a channel also go as voice notes.
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export function mediaTools(): Tool[] {
  return [
    defineTool({
      name: "voice_replies",
      description:
        "Turn spoken answers on or off for this chat: on a channel like Telegram your answers then also arrive as voice notes. Use it when the owner asks to hear you (or to stop).",
      args: z.object({ on: z.boolean() }),
      effect: "local",
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
        "Draw an image from a description, with the owner's image services; it appears in this chat. Describe subject, style and light in English for best results. Optional size (width/height), count (1-4) and what to avoid (negative_prompt).",
      args: z.object({
        prompt: z.string().trim().min(3).max(2000),
        negative_prompt: z.string().max(1000).optional(),
        width: z.number().int().min(256).max(2048).optional(),
        height: z.number().int().min(256).max(2048).optional(),
        count: z.number().int().min(1).max(4).optional(),
      }),
      effect: "external",
      // A page or another agent could make the agent draw for it: ask the owner then.
      confirm: "untrusted",
      deadlineMs: 11 * 60_000,
      title: (a) => `Drew: ${String(a.prompt ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const r = await ctx.call("media.image", { ...a, thread: ctx.thread.id });
        for (const m of r.media)
          ctx.upsertPart((p) => p.type === "image" && p.media_id === m.id, {
            type: "image",
            media_id: m.id,
            mime: m.mime,
            alt: a.prompt.slice(0, 200),
          });
        const note = r.skipped.length ? ` (skipped: ${r.skipped.join("; ")})` : "";
        return `${r.media.length} image(s) shown in the chat, drawn by ${r.service}${r.model ? ` with ${r.model}` : ""}${note}.`;
      },
    }),
  ];
}
