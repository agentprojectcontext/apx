// Image and voice services (owner-only settings) and what they make. An agent draws or speaks only into its own
// thread, through the same methods.

import { errorMessage, notFound, unavailable } from "../errors.ts";
import type { Services } from "../services/registry.ts";
import type { CallContext } from "./context.ts";
import type { Handler } from "./router.ts";

const failed = (err: unknown) => unavailable(errorMessage(err, 2000));

/** The thread a result belongs to: an agent's own, whatever it asked for. */
const threadOf = (ctx: CallContext, asked: string | undefined) => (ctx.agent ? ctx.agent.thread_id : asked);

export function mediaHandlers(services: Services) {
  return {
    "services.list": (async ({ kind }) => ({
      services: await services.info(kind),
      image_defaults: services.imageDefaults(),
    })) as Handler<"services.list">,
    "services.set": (async ({ id, service, api_key }) => {
      services.set(id, service, api_key);
      return { services: await services.info() };
    }) as Handler<"services.set">,
    "services.order": (async ({ kind, ids }) => {
      services.order(kind, ids);
      return { services: await services.info(kind) };
    }) as Handler<"services.order">,
    "services.defaults": ((d) => services.setImageDefaults(d)) as Handler<"services.defaults">,

    "media.image": (async (p, ctx) => {
      try {
        const r = await services.image({ ...p, thread: threadOf(ctx, p.thread) }, AbortSignal.timeout(11 * 60_000));
        return {
          media: r.media.map((m) => ({ id: m.id, mime: m.mime })),
          service: r.service.label,
          ...(r.model ? { model: r.model } : {}),
          skipped: r.skipped,
        };
      } catch (err) {
        throw failed(err);
      }
    }) as Handler<"media.image">,
    "media.speak": (async (p, ctx) => {
      try {
        const r = await services.speak({ ...p, thread: threadOf(ctx, p.thread) }, AbortSignal.timeout(2 * 60_000));
        return { media: { id: r.media.id, mime: r.media.mime }, service: r.service.label, skipped: r.skipped };
      } catch (err) {
        throw failed(err);
      }
    }) as Handler<"media.speak">,
    "media.get": (({ id }) => {
      const m = services.read(id);
      if (!m) throw notFound(`media ${id}`);
      return { mime: m.mime, data: m.data.toString("base64"), bytes: m.data.length };
    }) as Handler<"media.get">,
  };
}
