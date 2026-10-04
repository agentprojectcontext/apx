// The owner's phone, as a node: where they are, and a picture they take on it. Offered only while a phone lending the
// capability is connected (engine/turn.ts). Where the owner is goes to a model only with the owner's OK when outside
// content is in the turn; a picture always asks them, on the phone.
import { PHONE_CAMERA_CAP, PHONE_LOCATION_CAP } from "@apx/protocol";
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export function phoneTools(): Tool[] {
  return [
    defineTool({
      name: "phone_location",
      description:
        "Where the owner's phone is now (latitude, longitude, accuracy). Use it for nearby places, travel or the weather there.",
      args: z.object({}),
      effect: "none",
      confirm: "untrusted",
      needsCap: PHONE_LOCATION_CAP,
      deadlineMs: 15_000,
      title: () => "Read where your phone is",
      async run(_a, ctx) {
        const r = await ctx.call("phone.location", {});
        const acc = r.accuracy_m === undefined ? "" : ` (±${Math.round(r.accuracy_m)} m)`;
        return `lat ${r.lat.toFixed(5)}, lon ${r.lon.toFixed(5)}${acc}, at ${r.at}`;
      },
    }),
    defineTool({
      name: "phone_photo",
      description: "Ask the owner to take a picture with their phone (say why in reason); it appears in this chat.",
      args: z.object({ reason: z.string().max(200).optional() }),
      effect: "external",
      confirm: "never",
      needsCap: PHONE_CAMERA_CAP,
      deadlineMs: 100_000,
      title: () => "Asked for a picture from your phone",
      async run(a, ctx) {
        const r = await ctx.call("phone.photo", { ...(a.reason ? { reason: a.reason } : {}), thread: ctx.thread.id });
        ctx.upsertPart((p) => p.type === "image" && p.media_id === r.media.id, {
          type: "image",
          media_id: r.media.id,
          mime: r.media.mime,
          alt: a.reason ?? "A picture from the owner's phone",
        });
        return `the owner took a picture (media ${r.media.id}); it is shown in the chat`;
      },
    }),
  ];
}
