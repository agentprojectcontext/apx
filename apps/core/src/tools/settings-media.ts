// apx_settings, the media services and memory's embedding engine: the super-agent sets up a service or Ollama's
// embeddings for memory at the owner's word, never typing a key (DECISIONS.md#d-264). A change is tried before it is
// saved, so a service that does not answer never replaces one that works.
import type { ServiceSettings } from "@apx/protocol";
import { memorySettings } from "../domain/memory-settings.ts";
import { keyLike } from "../log.ts";
import { EMBED_MODELS, recommendEmbedder } from "../services/local-embed.ts";
import { imageDefaultsOf } from "../services/registry.ts";
import { inlineName } from "./result.ts";
import { merged, type Params, type Setting, str } from "./settings-kit.ts";

type Saved = ServiceSettings & { id: string };
const savedOf = (store: Parameters<NonNullable<Setting["read"]>>[1]["store"], id: unknown): Saved | undefined =>
  (store.settings.read("services") as Saved[]).find((s) => s.id === str(id));

const KEY = "the owner types a service's key themselves, in Settings › Services";

/** A change that sends a saved key somewhere else, or deletes it: the owner's card in every mode. */
const movesKey = (p: Params, now: Saved | undefined): boolean => {
  if (!now?.needs_key) return false;
  if (p.service === null) return true;
  const s = (p.service ?? {}) as Partial<ServiceSettings>;
  return (
    (s.base_url !== undefined && s.base_url !== now.base_url) || (s.dialect !== undefined && s.dialect !== now.dialect)
  );
};

export const MEDIA: Readonly<Record<string, Setting>> = {
  "services.list": {
    does: "the media services (image, speech, embedding, transcription), in the order they are tried, and the image defaults",
    read: (_p, { store }) =>
      [
        ...(store.settings.read("services") as Saved[]).map(
          (s) =>
            `- ${inlineName(s.label)} [${s.id}] (${s.kind}, ${s.dialect}, ${s.enabled ? "on" : "off"}${s.model ? `, model ${s.model}` : ""}${s.needs_key ? ", needs a key" : ""})`,
        ),
        `image defaults: ${JSON.stringify(imageDefaultsOf(store))}`,
      ].join("\n"),
  },
  "services.set": {
    does: "add, change (only what changes) or (service: null) remove a media service (id; service: kind, dialect, label, base_url, enabled, needs_key, model…). Tried before it is saved; a key is the owner's to type",
    named: ["id"],
    says: (p, { store }) => {
      const now = savedOf(store, p.id);
      const label = inlineName(str((p.service as Params | null)?.label) || now?.label || str(p.id));
      return `${p.service === null ? "Remove" : now ? "Change" : "Add"} the service ${label}`;
    },
    now: (p, { store }) => {
      const now = savedOf(store, p.id);
      if (!now) return undefined;
      const { id: _i, ...service } = now;
      return { id: now.id, service };
    },
    keep: (p, { store }) => {
      const now = savedOf(store, p.id);
      if (!now || !p.service || typeof p.service !== "object") return p;
      const { id: _i, ...service } = now;
      return { ...p, service: merged(service, p.service as Params) };
    },
    refuse: (p) => {
      if (p.api_key !== undefined) return KEY;
      const s = (p.service ?? {}) as Params;
      const pasted = Object.entries(s).find(([, v]) => typeof v === "string" && keyLike(v));
      return pasted ? `${pasted[0]} looks like a key: ${KEY}` : undefined;
    },
    asks: (p, { store }) => (movesKey(p, savedOf(store, p.id)) ? "card" : undefined),
    // Tried first: a service that does not answer is not saved, so what works now keeps working.
    owner: async (p, { store }, call) => {
      const service = p.service as ServiceSettings | null;
      if (service?.enabled) {
        const keyed = service.needs_key && savedOf(store, p.id)?.needs_key;
        const t = await call("services.test", { service, ...(keyed ? { id: str(p.id) } : {}) });
        if (!t.ok && !(t.problem === "key" && !keyed))
          return `not saved: the service did not answer (${t.problem ?? "error"}${t.detail ? `: ${t.detail.slice(0, 200)}` : ""}); nothing changed`;
        if (!t.ok) {
          await call("services.set", { id: str(p.id), service: { ...service, enabled: false } });
          return "saved off: it needs a key. Ask the owner to type it in Settings › Services and turn it on there";
        }
      }
      await call("services.set", { id: str(p.id), service });
      return service === null ? "removed" : `saved; services.list shows it${service.enabled ? " (it answered)" : ""}`;
    },
  },
  "embeddings.local": {
    does: "memory's embedding engine on this computer: the models Ollama can run here, the one that fits, the embedding services and memory's search mode",
    read: (_p, { store }) =>
      [
        `models: ${EMBED_MODELS.map((m) => `${m.id} (${m.mb} MB, ${m.quality})`).join(", ")}`,
        `fits this computer: ${recommendEmbedder()}`,
        `embedding services, tried in order: ${
          (store.settings.read("services") as Saved[])
            .filter((s) => s.kind === "embedding")
            .map((s) => `${s.id} (${s.enabled ? "on" : "off"}${s.model ? `, ${s.model}` : ""})`)
            .join(", ") || "none"
        }`,
        `memory search: ${memorySettings(store).mode} (semantic searches by meaning with the first embedding service)`,
        'To set it up: embeddings.install {model}, then memory.set_settings {mode: "semantic"}.',
      ].join("\n"),
  },
  "embeddings.install": {
    does: "make Ollama on this computer memory's embedding engine with model (from embeddings.local), first in the order; a model Ollama lacks is downloaded in the background. Ollama itself is the owner's to install",
    named: ["model"],
    says: (p) => `Use ${str(p.model)} on this computer to search memory by meaning`,
    refuse: (p) =>
      EMBED_MODELS.some((m) => m.id === str(p.model))
        ? undefined
        : `pick one of ${EMBED_MODELS.map((m) => m.id).join(", ")}: another model is the owner's to set in Settings › Memory`,
    shows: (r) => {
      const s = r as { ollama?: { running?: boolean }; pull?: { model: string; error?: string }; active?: string };
      if (s.pull?.error) return `the download failed (${s.pull.error}); memory keeps its engine`;
      if (s.pull) return `downloading ${s.pull.model}; memory switches to it once it is here`;
      return `memory's engine is now ${s.active ?? "set"}; memory.set_settings {mode: "semantic"} searches by meaning`;
    },
  },
};
