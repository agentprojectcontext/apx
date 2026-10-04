// v1's media engines as v2 services: image generators (images.*), voices (voice.tts.*) and speech-to-text
// (transcription), in v1's order, with the shared image defaults and whether replies were spoken. v1's folder is only
// read; keys go to v2's secret store under the service. A service v2 already has (same id) is left as it is.
import { type ImageDefaults, type ServiceKind, ServiceSettings } from "@apx/protocol";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import type { Services } from "../services/registry.ts";
import { v1ImageDefaults, v1ServiceId, v1Services } from "./v1.ts";
import { v1Config, v1EngineKey } from "./v1-data.ts";

type Planned = { id: string; settings: ServiceSettings; api_key?: string | undefined };
export type V1MediaPlan = {
  services: Planned[];
  /** Per kind, v2 ids in the order v1 tried them (the first one answers in v2). */
  order: Partial<Record<ServiceKind, string[]>>;
  imageDefaults: Partial<ImageDefaults>;
  voiceReplies: boolean;
};

/** v1's local whisper server (host/daemon/whisper-server.py): POST /transcribe with a file path. */
const V1_WHISPER_URL = "http://127.0.0.1:18765";
const GEMINI_URL = "https://generativelanguage.googleapis.com";
const OPENAI_URL = "https://api.openai.com/v1";
/** v1's own fallback order when the owner set none; custom endpoints follow. */
const IMAGE_AUTO = ["a1111", "sdcpp", "openai"];
const TTS_AUTO = ["piper", "elevenlabs", "openai", "gemini"];

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** v1 routes a family as a chain (first that answers) or a single engine; v2 always chains, so others come in off. */
function routing(cfg: Record<string, unknown>, auto: string[], customs: string[]) {
  const provider = str(cfg.provider);
  const single = cfg.mode === "single" || (cfg.mode !== "chain" && !!provider && provider !== "auto");
  const known = [...auto, ...customs.map((s) => `custom:${s}`)];
  const ordered = list(cfg.order).filter((x): x is string => typeof x === "string" && known.includes(x));
  const chain = [...ordered, ...known.filter((x) => !ordered.includes(x))];
  const first = single && provider ? [provider, ...chain.filter((x) => x !== provider)] : chain;
  return { order: first, on: (id: string) => !single || id === provider };
}

/** v1's engine id ("custom:qvox", "gemini") as the v2 service id it becomes. */
const idOf = (v1: string, builtin: Record<string, string>) =>
  v1.startsWith("custom:") ? v1ServiceId(v1.slice(7)) : builtin[v1];

function images(config: Record<string, unknown>, customs: Planned[], out: V1MediaPlan) {
  const img = obj(config.images);
  const raw = obj(img.custom);
  const { order, on } = routing(img, IMAGE_AUTO, Object.keys(raw));
  const builtin: Record<string, string> = { a1111: "v1-a1111", sdcpp: "v1-sdcpp", openai: "v1-openai-images" };
  for (const [slug, c] of Object.entries(raw)) {
    const s = customs.find((x) => x.id === v1ServiceId(slug) && x.settings.kind === "image");
    const key = str(obj(c).api_key);
    if (s)
      out.services.push({
        ...s,
        settings: { ...s.settings, enabled: s.settings.enabled && on(`custom:${slug}`), needs_key: !!key },
        ...(key ? { api_key: key } : {}),
      });
  }
  for (const id of ["a1111", "sdcpp"] as const) {
    const c = obj(img[id]);
    const base = str(c.base_url);
    if (!base) continue;
    const defaults = v1ImageDefaults(obj(c.defaults));
    out.services.push({
      id: builtin[id] as string,
      settings: {
        kind: "image",
        dialect: id,
        label: id === "a1111" ? "Stable Diffusion (A1111)" : "stable-diffusion.cpp",
        base_url: base,
        enabled: c.enabled !== false && on(id),
        needs_key: false,
        ...(str(c.model) ? { model: str(c.model) } : {}),
        ...(Object.keys(defaults).length ? { defaults } : {}),
      },
    });
  }
  // v1 drew with OpenAI on the chat engine's key when nothing local answered; a custom address uses only its own.
  const oa = obj(img.openai);
  const oaKey = str(oa.base_url) ? str(oa.api_key) : (str(oa.api_key) ?? v1EngineKey(config, "openai"));
  if (oaKey || str(oa.base_url))
    out.services.push({
      id: builtin.openai as string,
      settings: {
        kind: "image",
        dialect: "openai-images",
        label: "OpenAI images",
        base_url: str(oa.base_url) ?? OPENAI_URL,
        enabled: oa.enabled !== false && on("openai"),
        needs_key: !!oaKey,
        ...(str(oa.model) ? { model: str(oa.model) } : {}),
      },
      ...(oaKey ? { api_key: oaKey } : {}),
    });
  out.order.image = order.flatMap((x) => idOf(x, builtin) ?? []);
  out.imageDefaults = v1ImageDefaults(obj(img.defaults));
}

function voices(config: Record<string, unknown>, customs: Planned[], out: V1MediaPlan) {
  const tts = obj(obj(config.voice).tts);
  const raw = obj(tts.custom);
  const { order, on } = routing(tts, TTS_AUTO, Object.keys(raw));
  const builtin: Record<string, string> = { gemini: "v1-gemini-speech", openai: "v1-openai-speech" };
  for (const [slug, c] of Object.entries(raw)) {
    const s = customs.find((x) => x.id === v1ServiceId(slug) && x.settings.kind === "speech");
    const key = str(obj(c).api_key);
    if (s)
      out.services.push({
        ...s,
        settings: { ...s.settings, enabled: s.settings.enabled && on(`custom:${slug}`), needs_key: !!key },
        ...(key ? { api_key: key } : {}),
      });
  }
  // Gemini's voice: its own key, else the Gemini engine's (as v1's adapter read it).
  const g = obj(tts.gemini);
  const gKey = str(g.api_key) ?? v1EngineKey(config, "gemini");
  if (gKey)
    out.services.push({
      id: builtin.gemini as string,
      settings: {
        kind: "speech",
        dialect: "gemini-speech",
        label: "Gemini voice",
        base_url: GEMINI_URL,
        enabled: g.enabled !== false && on("gemini"),
        needs_key: true,
        ...(str(g.model) ? { model: str(g.model) } : {}),
        ...(str(g.voice) ? { voice: str(g.voice)?.slice(0, 100) } : {}),
        ...(str(g.style) ? { style: str(g.style)?.slice(0, 300) } : {}),
      },
      api_key: gKey,
    });
  const o = obj(tts.openai);
  const oKey = str(o.base_url) ? str(o.api_key) : (str(o.api_key) ?? v1EngineKey(config, "openai"));
  if (oKey || str(o.base_url))
    out.services.push({
      id: builtin.openai as string,
      settings: {
        kind: "speech",
        dialect: "openai-speech",
        label: "OpenAI voice",
        base_url: str(o.base_url) ?? OPENAI_URL,
        enabled: o.enabled !== false && on("openai"),
        needs_key: !!oKey,
        ...(str(o.model) ? { model: str(o.model) } : {}),
        ...(str(o.voice) ? { voice: str(o.voice)?.slice(0, 100) } : {}),
      },
      ...(oKey ? { api_key: oKey } : {}),
    });
  out.order.speech = order.flatMap((x) => idOf(x, builtin) ?? []);
  out.voiceReplies = obj(config.voice).voice_replies === true;
}

/** v1's speech-to-text: its local whisper server, a custom OpenAI-compatible one, or OpenAI, as v1 chose. */
function transcription(config: Record<string, unknown>, out: V1MediaPlan) {
  if (!("transcription" in config)) return;
  const t = obj(config.transcription);
  const provider = str(t.provider) ?? "auto";
  // v1 asked in the owner's language unless an engine named one.
  const lang = (c: Record<string, unknown>) => {
    const l = str(c.language);
    const user = str(obj(config.user).language);
    return l && l !== "auto" ? l : user && /^[a-z]{2}$/.test(user) ? user : undefined;
  };
  const local = obj(t.local);
  const custom = obj(t.custom);
  const openai = obj(t.openai);
  const openaiKey = str(openai.api_key) ?? v1EngineKey(config, "openai");
  const add = (id: string, s: Omit<ServiceSettings, "kind" | "enabled">, key?: string) => {
    out.services.push({
      id,
      settings: { kind: "transcription", enabled: true, ...s },
      ...(key ? { api_key: key } : {}),
    });
    out.order.transcription = [...(out.order.transcription ?? []), id];
  };
  if (provider === "local" || provider === "auto") {
    const l = lang(local);
    add("v1-whisper", {
      dialect: "whisper-local",
      label: "Whisper (v1)",
      base_url: V1_WHISPER_URL,
      needs_key: false,
      ...(l ? { language: l } : {}),
    });
  }
  const customUrl = str(custom.base_url);
  if (customUrl && (provider === "custom" || provider === "auto")) {
    const key = str(custom.api_key);
    const l = lang(custom);
    add(
      "v1-transcribe",
      {
        dialect: "openai-transcribe",
        label: "Transcription (v1)",
        base_url: customUrl,
        needs_key: !!key,
        ...(str(custom.model) ? { model: str(custom.model) } : {}),
        ...(l ? { language: l } : {}),
      },
      key,
    );
  }
  if (openaiKey && (provider === "openai" || (provider === "auto" && !customUrl))) {
    const l = lang(openai);
    add(
      "v1-openai-transcribe",
      {
        dialect: "openai-transcribe",
        label: "OpenAI Whisper",
        base_url: str(openai.base_url) ?? OPENAI_URL,
        needs_key: true,
        ...(str(openai.model) ? { model: str(openai.model) } : {}),
        ...(l ? { language: l } : {}),
      },
      openaiKey,
    );
  }
}

/** Everything v1 used for images, voices and transcription, as v2 would take it; entries v2 cannot hold are dropped. */
export function v1Media(home: string): V1MediaPlan {
  const config = v1Config(home);
  const out: V1MediaPlan = { services: [], order: {}, imageDefaults: {}, voiceReplies: false };
  const customs = v1Services(config);
  images(config, customs, out);
  voices(config, customs, out);
  transcription(config, out);
  out.services = out.services.filter(
    (s, i, all) =>
      /^[a-z0-9][a-z0-9-]{0,31}$/.test(s.id) &&
      ServiceSettings.safeParse(s.settings).success &&
      all.findIndex((x) => x.id === s.id) === i,
  );
  return out;
}

export type MediaImportDeps = {
  store: Store;
  services: Pick<Services, "set" | "has" | "order">;
};

/**
 * Brings v1's media services in. A new one lands in v1's order (the active voice first); one v2 already has stays as
 * the owner left it, and so do image defaults the owner set. Returns how many things came in.
 */
export function importV1Media(deps: MediaImportDeps, home: string): number {
  const { store, services } = deps;
  const plan = v1Media(home);
  let n = 0;
  const added = new Set<ServiceKind>();
  for (const s of plan.services) {
    if (services.has(s.id)) continue;
    services.set(s.id, s.settings, s.api_key);
    added.add(s.settings.kind);
    n++;
  }
  // Only when something of that kind is new: a second import does not reshuffle the owner's order.
  for (const kind of added) {
    const ids = plan.order[kind];
    if (ids?.length) services.order(kind, ids);
  }
  const have = store.settings.read("image_defaults");
  const missing = Object.fromEntries(Object.entries(plan.imageDefaults).filter(([k]) => !(k in have)));
  if (Object.keys(missing).length) {
    store.settings.write("image_defaults", { ...have, ...missing });
    n++;
  }
  // v1's spoken replies were one standing switch; in v2 it is per chat, and the owner's channels land in Home.
  if (plan.voiceReplies && store.threads.get(HOME_THREAD_ID)) {
    if (store.threads.context(HOME_THREAD_ID).voice_replies === undefined) {
      store.threads.mergeContext(HOME_THREAD_ID, { voice_replies: true });
      n++;
    }
  }
  return n;
}

/** How many media services v1 has that v2 can take. */
export const v1MediaCount = (home: string) => v1Media(home).services.length;
