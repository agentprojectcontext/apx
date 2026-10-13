// The owner's image and voice services: kept in settings in the owner's order, keys in the secret store. A request
// goes to the first enabled service of its kind that answers; one that failed a moment ago is skipped for a while
// instead of being waited on again. What a service makes is saved under the home and recorded in `media`.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ImageDefaults, ServiceInfo, ServiceKind, ServiceSettings, ServiceTest } from "@apx/protocol";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import { toOggOpus } from "./audio.ts";
import { EMBED_PROBE, embed } from "./embeddings.ts";
import { generateImage, IMAGE_PROBE } from "./images.ts";
import { reach } from "./reach.ts";
import { SPEECH_PROBE, speak } from "./speech.ts";
import { TRANSCRIBE_PROBE, transcribe } from "./transcription.ts";
import { PROBE_TIMEOUT_MS, type ServiceConfig } from "./types.ts";
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

/** The path each dialect is asked on to see whether it answers (and what it lists). */
const PROBES: Record<ServiceKind, Record<string, string>> = {
  image: IMAGE_PROBE,
  speech: SPEECH_PROBE,
  embedding: EMBED_PROBE,
  transcription: TRANSCRIBE_PROBE,
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

  const all = (): ServiceConfig[] => store.settings.read("services");
  const save = (list: ServiceConfig[]) => store.settings.write("services", list);
  const ofKind = (kind: ServiceKind) => all().filter((s) => s.kind === kind);

  async function check(s: ServiceConfig): Promise<boolean> {
    const cached = status.get(s.id);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.ok;
    const path = PROBES[s.kind][s.dialect] ?? "/";
    // APX's own whisper.cpp is not started just to be checked.
    const ok =
      s.dialect === "whisper-cpp"
        ? whisperCpp.available(s.model)
        : (await reach(s, path, keyOf(s), f, PROBE_TIMEOUT_MS)).ok;
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
    return { ...BASE_DEFAULTS, ...store.settings.read("image_defaults") };
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
      store.settings.write("image_defaults", d);
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
    async transcribe(
      a: { bytes: Buffer; mime: string; thread?: string | undefined; media?: MediaRecord | undefined },
      signal: AbortSignal,
    ) {
      const media = a.media ?? saveFile(a.bytes, a.mime, { kind: "audio", thread_id: a.thread });
      const { out } = await firstThatWorks(candidates("transcription"), (s) =>
        transcribe(s, { path: media.path, bytes: a.bytes, mime: a.mime }, keyOf(s), signal, f, whisperCpp),
      );
      return { text: out, media };
    },
    /** Asks a service now (saved as `id`, or still a draft): whether it answers, why not, and its models. */
    async test(s: ServiceSettings, id?: string, apiKey?: string): Promise<ServiceTest> {
      const saved = id ? all().find((x) => x.id === id) : undefined;
      const cfg: ServiceConfig = { ...s, id: saved?.id ?? "" };
      const r =
        s.dialect === "whisper-cpp"
          ? whisperCpp.available(s.model)
            ? { ok: true }
            : { ok: false, problem: "other" as const, detail: "whisper-server or the model file is missing" }
          : await reach(cfg, PROBES[s.kind][s.dialect] ?? "/", apiKey ?? (saved ? keyOf(cfg) : undefined), f);
      if (saved) status.set(saved.id, { ok: r.ok, at: Date.now() });
      return r;
    },
    /** Words heard so far, from whisper.cpp on this machine only (free, in memory); undefined without it. */
    async listen(bytes: Buffer, mime: string, signal: AbortSignal): Promise<string | undefined> {
      const s = ofKind("transcription").find((x) => x.enabled);
      if (s?.dialect !== "whisper-cpp" || !whisperCpp.available(s.model)) return undefined;
      return transcribe(s, { path: "", bytes, mime }, undefined, signal, f, whisperCpp);
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
    /** The embedding engine in use as the owner reads it ("Ollama · bge-m3"). */
    embeddingLabel(): string | undefined {
      const s = ofKind("embedding").find((x) => x.enabled);
      return s ? [s.label, s.model].filter(Boolean).join(" · ") : undefined;
    },
    /** Stops what APX runs itself (its whisper.cpp). */
    close: () => whisperCpp.close(),
    /** A media file's bytes; only files APX itself recorded are ever read. */
    /** Keeps bytes APX was handed (a contact's profile picture) as media, read back through media.get. */
    keep(bytes: Buffer, mime: string): MediaRecord {
      return saveFile(bytes, mime, { kind: "image" });
    },
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
