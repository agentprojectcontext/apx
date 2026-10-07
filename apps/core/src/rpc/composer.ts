// The composer's calls: attachments, dictation and the chat's own model.
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { badRequest, errorMessage, notFound, unauthorized, unavailable } from "../errors.ts";
import { saveLocalAttachment } from "../services/attachment-files.ts";
import type { Services } from "../services/registry.ts";
import { saveUpload } from "../services/uploads.ts";
import type { Handlers } from "./router.ts";

export function composerHandlers(deps: {
  store: Store;
  home: string;
  services: Services;
  workFolder(thread: NonNullable<ReturnType<Store["threads"]["get"]>>): string;
  /** `session`: the CLI whose own session the chat is (only that CLI runs there). */
  checkModel(ref: string, session: string | undefined): string | undefined;
}) {
  const { store } = deps;
  return {
    "media.attach": ({ path, document }, ctx) => {
      const caller = ctx.agent;
      const run = caller && store.runs.get(caller.run_id);
      const thread = caller && store.threads.get(caller.thread_id);
      if (!caller || !thread || run?.agent_id !== caller.id || run.thread_id !== thread.id || run.state !== "working")
        throw unauthorized("only the running agent can attach a file to its own chat");
      if (audienceOf(store, thread).kind !== "owner")
        throw unauthorized("local files can only be attached in the owner's chats");
      try {
        const m = saveLocalAttachment(deps.home, store, deps.workFolder(thread), thread.id, path, document);
        return { media: { id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, name: m.name } };
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "media.upload": ({ name, mime, data, thread }) => {
      if (thread && !store.threads.get(thread)) throw notFound(`thread ${thread}`);
      try {
        const m = saveUpload(deps.home, store, { name, mime, bytes: Buffer.from(data, "base64"), thread });
        return {
          media: { id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, name: m.name },
        };
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "media.transcribe": async ({ data, mime, media_id, thread }) => {
      if (thread && !store.threads.get(thread)) throw notFound(`thread ${thread}`);
      const media = media_id ? store.media.get(media_id) : undefined;
      if (media_id && (media?.kind !== "audio" || media.service || (media.thread_id && media.thread_id !== thread)))
        throw badRequest(`no audio upload ${media_id} in this chat`);
      const stored = media ? deps.services.read(media.id) : undefined;
      if (media && !stored) throw notFound(`audio ${media.id}`);
      if (!deps.services.hasKind("transcription"))
        throw unavailable("no transcription engine is set up (Settings › Voices)");
      try {
        const r = await deps.services.transcribe(
          { bytes: stored?.data ?? Buffer.from(data ?? "", "base64"), mime: stored?.mime ?? mime ?? "", thread, media },
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
      const why = model_choice?.model ? deps.checkModel(model_choice.model, t.engine) : undefined;
      if (why) throw badRequest(why);
      store.threads.mergeContext(thread, { model_choice: model_choice ?? undefined });
      return model_choice ? { model_choice } : {};
    },
  } satisfies Partial<Handlers>;
}
