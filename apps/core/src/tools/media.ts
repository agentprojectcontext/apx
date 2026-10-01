// make_image: an agent draws with the owner's image services (a homelab GPU, an API) and the image appears in the chat.
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export function mediaTools(): Tool[] {
  return [
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
