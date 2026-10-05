// The composer's calls: attachments, dictation and the chat's own model.
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound, unavailable } from "../errors.ts";
import type { Services } from "../services/registry.ts";
import { saveUpload } from "../services/uploads.ts";
import type { Handlers } from "./router.ts";

export function composerHandlers(deps: {
  store: Store;
  home: string;
  services: Services;
  /** `session`: the chat is a CLI's own session, where that CLI may run. */
  checkModel(ref: string, session: boolean): string | undefined;
}) {
  const { store } = deps;
  return {
    "media.upload": ({ name, mime, data, thread }) => {
      if (thread && !store.threads.get(thread)) throw notFound(`thread ${thread}`);
      try {
        const m = saveUpload(deps.home, store, { name, mime, bytes: Buffer.from(data, "base64"), thread });
        return {
          media: { id: m.id, kind: m.kind === "image" ? "image" : "file", mime: m.mime, bytes: m.bytes, name: m.name },
        };
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "media.transcribe": async ({ data, mime, thread }) => {
      if (!deps.services.hasKind("transcription"))
        throw unavailable("no transcription engine is set up (Settings › Voices)");
      try {
        const r = await deps.services.transcribe(
          { bytes: Buffer.from(data, "base64"), mime, thread },
          AbortSignal.timeout(3 * 60_000),
        );
        return { text: r.text, service: r.media.service ?? "" };
      } catch (err) {
        throw unavailable(errorMessage(err, 500));
      }
    },
    "threads.model": ({ thread, model_choice }) => {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      const why = model_choice?.model ? deps.checkModel(model_choice.model, Boolean(t.engine)) : undefined;
      if (why) throw badRequest(why);
      store.threads.mergeContext(thread, { model_choice: model_choice ?? undefined });
      return model_choice ? { model_choice } : {};
    },
  } satisfies Partial<Handlers>;
}
