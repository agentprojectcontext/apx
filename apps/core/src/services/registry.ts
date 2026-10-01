// The owner's image and voice services: kept in settings in the owner's order, keys in the secret store. A request
// goes to the first enabled service of its kind that answers; one that failed a moment ago is skipped for a while
// instead of being waited on again. What a service makes is saved under the home and recorded in `media`.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ImageDefaults, ServiceInfo, ServiceKind, ServiceSettings } from "@apx/protocol";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import { toOggOpus } from "./audio.ts";
import { EMBED_PROBE, embed } from "./embeddings.ts";
import { generateImage, IMAGE_PROBE, probe } from "./images.ts";
import { SPEECH_PROBE, speak } from "./speech.ts";
import { TRANSCRIBE_PROBE, transcribe } from "./transcription.ts";
import type { ServiceConfig } from "./types.ts";
import { createWhisperCpp, type WhisperCpp } from "./whisper-cpp.ts";

/** The bottom layer under every image: a service's own defaults and the call's arguments go on top. */
const BASE_DEFAULTS: ImageDefaults = {
  width: 512,
  height: 512,
  steps: 20,
  cfg_scale: 7,
  negative_prompt: "",
  count: 1,
};

/** How long a check (or a failure) is trusted before asking the service again. */
const STATUS_TTL_MS = 30_000;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

export type ImageCall = Partial<ImageDefaults> & {
  prompt: string;
  seed?: number | undefined;
  service?: string | undefined;
  thread?: string | undefined;
};

export function createServices(deps: {
  store: Store;
  secrets: Secrets;
  home: string;
  log: Log;
  fetch?: typeof fetch;
  whisperCpp?: WhisperCpp;
}) {
  const { store, secrets, log } = deps;
  const f = deps.fetch ?? fetch;
  const whisperCpp = deps.whisperCpp ?? createWhisperCpp({ log });
  const status = new Map<string, { ok: boolean; at: number }>();
  const keyName = (id: string) => `service-${id}`;
  const keyOf = (s: ServiceConfig) => (s.needs_key ? secrets.resolve(`secret://${keyName(s.id)}`) : undefined);

  function all(): ServiceConfig[] {
    try {
      const raw = JSON.parse(store.settings.get("services") ?? "[]") as ServiceConfig[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  const save = (list: ServiceConfig[]) => store.settings.set("services", JSON.stringify(list));
  const ofKind = (kind: ServiceKind) => all().filter((s) => s.kind === kind);

  async function check(s: ServiceConfig): Promise<boolean> {
    const cached = status.get(s.id);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.ok;
    const probes = {
      image: IMAGE_PROBE,
      speech: SPEECH_PROBE,
      embedding: EMBED_PROBE,
      transcription: TRANSCRIBE_PROBE,
    };
    const path = probes[s.kind][s.dialect] ?? "/";
    // APX's own whisper.cpp is not started just to be checked.
    const ok = s.dialect === "whisper-cpp" ? whisperCpp.available(s.model) : await probe(s, path, keyOf(s), f);
    status.set(s.id, { ok, at: Date.now() });
    return ok;
  }

  async function info(kind?: ServiceKind): Promise<ServiceInfo[]> {
    const list = kind ? ofKind(kind) : all();
    const checks = await Promise.all(list.map((s) => (s.enabled ? check(s) : Promise.resolve(undefined))));
    return list.map((s, i) => ({
      ...publicSettings(s),
      id: s.id,
      key_set: secrets.has(`secret://${keyName(s.id)}`),
      status: checks[i] === undefined ? "unknown" : checks[i] ? "reachable" : "unreachable",
    }));
  }

  function imageDefaults(): ImageDefaults {
    try {
      return {
        ...BASE_DEFAULTS,
        ...(JSON.parse(store.settings.get("image_defaults") ?? "{}") as Partial<ImageDefaults>),
      };
    } catch {
      return BASE_DEFAULTS;
    }
  }

  /** The services to try for one request: the one asked for, or every enabled one of the kind in order. */
  function candidates(kind: ServiceKind, only?: string): ServiceConfig[] {
    const list = ofKind(kind).filter((s) => (only ? s.id === only : s.enabled));
    if (only && !list.length) throw new Error(`no ${kind} service "${only}"`);
    if (!list.length) throw new Error(`no ${kind} service is set up: add one in Settings`);
    return list;
  }

  function saveFile(
    bytes: Buffer,
    mime: string,
    m: Omit<MediaRecord, "id" | "created_at" | "path" | "bytes" | "mime">,
  ) {
    const dir = path.join(deps.home, "media", new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.${EXT[mime] ?? "bin"}`);
    fs.writeFileSync(file, bytes);
    return store.media.add({ ...m, mime, bytes: bytes.length, path: file });
  }

  /** Runs `work` on each candidate until one succeeds; says why each one before it was skipped. */
  async function firstThatWorks<T>(list: ServiceConfig[], work: (s: ServiceConfig) => Promise<T>) {
    const skipped: string[] = [];
    for (const s of list) {
      const cached = status.get(s.id);
      if (list.length > 1 && cached && !cached.ok && Date.now() - cached.at < STATUS_TTL_MS) {
        skipped.push(`${s.label}: not reachable`);
        continue;
      }
      try {
        const out = await work(s);
        status.set(s.id, { ok: true, at: Date.now() });
        return { out, service: s, skipped };
      } catch (err) {
        const msg = errorMessage(err);
        status.set(s.id, { ok: false, at: Date.now() });
        log.warn({ service: s.id, err: msg.slice(0, 200) }, "media service failed, trying the next one");
        skipped.push(msg.slice(0, 200));
      }
    }
    throw new Error(`no service could do it: ${skipped.join("; ")}`);
  }

  return {
    info,
    has: (id: string) => all().some((s) => s.id === id),
    imageDefaults,
    setImageDefaults(d: ImageDefaults): ImageDefaults {
      store.settings.set("image_defaults", JSON.stringify(d));
      return imageDefaults();
    },
    set(id: string, s: ServiceSettings | null, apiKey?: string): void {
      if (apiKey) secrets.set(keyName(id), apiKey);
      const rest = all().filter((x) => x.id !== id);
      const prev = all().find((x) => x.id === id);
      // A changed service keeps its place in the order; a new one goes last.
      const next = s ? { ...s, id } : undefined;
      save(prev && next ? all().map((x) => (x.id === id ? next : x)) : next ? [...rest, next] : rest);
      if (!s) secrets.set(keyName(id), null);
      status.delete(id);
    },
    order(kind: ServiceKind, ids: string[]): void {
      const mine = ofKind(kind);
      const sorted = [
        ...ids.flatMap((id) => mine.filter((s) => s.id === id)),
        ...mine.filter((s) => !ids.includes(s.id)),
      ];
      save([...all().filter((s) => s.kind !== kind), ...sorted]);
    },
    async image(c: ImageCall, signal: AbortSignal) {
      const { out, service, skipped } = await firstThatWorks(candidates("image", c.service), (s) => {
        const d = { ...imageDefaults(), ...s.defaults };
        return generateImage(
          s,
          {
            prompt: c.prompt,
            width: c.width ?? d.width,
            height: c.height ?? d.height,
            steps: c.steps ?? d.steps,
            cfg_scale: c.cfg_scale ?? d.cfg_scale,
            negative_prompt: c.negative_prompt ?? d.negative_prompt,
            count: c.count ?? d.count,
            seed: c.seed ?? -1,
            sampler: "",
          },
          keyOf(s),
          signal,
          f,
        );
      });
      const media = out.images.map((img) =>
        saveFile(img.bytes, img.mime, { kind: "image", thread_id: c.thread, service: service.id, prompt: c.prompt }),
      );
      return { media, service, model: out.model, skipped };
    },
    async speak(
      c: { text: string; voice?: string | undefined; service?: string | undefined; thread?: string | undefined },
      signal: AbortSignal,
    ) {
      const { out, service, skipped } = await firstThatWorks(candidates("speech", c.service), (s) =>
        speak(s, { text: c.text, voice: c.voice }, keyOf(s), signal, f),
      );
      const media = saveFile(out.bytes, out.mime, {
        kind: "audio",
        thread_id: c.thread,
        service: service.id,
        prompt: c.text,
      });
      return { media, service, skipped };
    },
    /**
     * Texts as vectors with the first embedding engine that answers. `model` names the engine and model, so vectors
     * from different ones are never compared.
     */
    async embed(texts: string[], signal: AbortSignal) {
      const { out, service } = await firstThatWorks(candidates("embedding"), (s) =>
        embed(s, texts, keyOf(s), signal, f),
      );
      return { vectors: out, model: `${service.id}/${service.model ?? ""}` };
    },
    /** Whether a kind of service is set up (enabled), without calling it. */
    hasKind: (kind: ServiceKind) => ofKind(kind).some((s) => s.enabled),
    /** A voice note to text with the first transcription engine that answers; the audio is kept as media. */
    async transcribe(a: { bytes: Buffer; mime: string; thread?: string | undefined }, signal: AbortSignal) {
      const media = saveFile(a.bytes, a.mime, { kind: "audio", thread_id: a.thread });
      const { out } = await firstThatWorks(candidates("transcription"), (s) =>
        transcribe(s, { path: media.path, bytes: a.bytes, mime: a.mime }, keyOf(s), signal, f, whisperCpp),
      );
      return { text: out, media };
    },
    /**
     * Speech for a channel: synthesized, then as OGG/Opus (what Telegram plays as a voice note) when ffmpeg is here;
     * otherwise the original audio.
     */
    async voiceNote(text: string, thread: string | undefined, signal: AbortSignal) {
      const { out, service } = await firstThatWorks(candidates("speech"), (s) =>
        speak(s, { text }, keyOf(s), signal, f),
      );
      try {
        const ogg = await toOggOpus(out.bytes);
        return saveFile(ogg, "audio/ogg", { kind: "audio", thread_id: thread, service: service.id, prompt: text });
      } catch (err) {
        log.warn({ err: errorMessage(err, 200) }, "no ffmpeg conversion; the voice goes as a plain audio file");
        return saveFile(out.bytes, out.mime, { kind: "audio", thread_id: thread, service: service.id, prompt: text });
      }
    },
    /** The engine and model new vectors would come from, without calling it. */
    embeddingModel(): string | undefined {
      const s = ofKind("embedding").find((x) => x.enabled);
      return s ? `${s.id}/${s.model ?? ""}` : undefined;
    },
    /** Stops what APX runs itself (its whisper.cpp). */
    close: () => whisperCpp.close(),
    /** A media file's bytes; only files APX itself recorded are ever read. */
    read(id: string): { mime: string; data: Buffer } | undefined {
      const m = store.media.get(id);
      if (!m) return undefined;
      try {
        return { mime: m.mime, data: fs.readFileSync(m.path) };
      } catch {
        return undefined;
      }
    },
  };
}

const publicSettings = ({ id: _id, ...s }: ServiceConfig): ServiceSettings => s as ServiceSettings;

export type Services = ReturnType<typeof createServices>;
