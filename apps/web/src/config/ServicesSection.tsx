import type { ImageDefaults, ServiceDialect, ServiceInfo, ServiceKind, ServiceSettings } from "@apx/protocol";
import { Badge, Button, Dialog, EmptyState, IconButton, Icons, Input, SettingRow, Switch, Textarea } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Preset = { id: string; label: string; dialect: ServiceDialect; base_url: string; needs_key: boolean } & Partial<
  Pick<ServiceSettings, "model" | "voice" | "language">
>;

const PRESETS: Record<ServiceKind, Preset[]> = {
  image: [
    { id: "a1111", label: "A1111 / Forge", dialect: "a1111", base_url: "http://localhost:7860", needs_key: false },
    {
      id: "sdcpp",
      label: "stable-diffusion.cpp",
      dialect: "sdcpp",
      base_url: "http://localhost:8080",
      needs_key: false,
    },
    {
      id: "openai",
      label: "OpenAI",
      dialect: "openai-images",
      base_url: "https://api.openai.com",
      needs_key: true,
      model: "gpt-image-1",
    },
    {
      id: "compatible",
      label: "OpenAI-compatible",
      dialect: "openai-images",
      base_url: "http://localhost:8000/v1",
      needs_key: false,
    },
  ],
  speech: [
    {
      id: "qvox",
      label: "QVox",
      dialect: "openai-speech",
      base_url: "http://127.0.0.1:5111/v1",
      needs_key: false,
      language: "es",
    },
    {
      id: "pocket",
      label: "Pocket TTS",
      dialect: "openai-speech",
      base_url: "http://127.0.0.1:5112/v1",
      needs_key: false,
    },
    {
      id: "openai",
      label: "OpenAI",
      dialect: "openai-speech",
      base_url: "https://api.openai.com/v1",
      needs_key: true,
      model: "tts-1",
      voice: "alloy",
    },
    {
      id: "gemini",
      label: "Gemini",
      dialect: "gemini-speech",
      base_url: "https://generativelanguage.googleapis.com",
      needs_key: true,
      voice: "Kore",
    },
    {
      id: "compatible",
      label: "OpenAI-compatible",
      dialect: "openai-speech",
      base_url: "http://localhost:8000/v1",
      needs_key: false,
    },
  ],
  transcription: [
    {
      id: "whispercpp",
      label: "whisper.cpp (this Mac)",
      dialect: "whisper-cpp",
      base_url: "http://127.0.0.1",
      needs_key: false,
      language: "es",
      model: "~/models/ggml-small.bin",
    },
    {
      id: "whisper",
      label: "Whisper (this Mac)",
      dialect: "whisper-local",
      base_url: "http://127.0.0.1:18765",
      needs_key: false,
      language: "es",
    },
    {
      id: "openai",
      label: "OpenAI",
      dialect: "openai-transcribe",
      base_url: "https://api.openai.com/v1",
      needs_key: true,
      model: "whisper-1",
    },
    {
      id: "compatible",
      label: "OpenAI-compatible",
      dialect: "openai-transcribe",
      base_url: "http://localhost:8000/v1",
      needs_key: false,
    },
  ],
  embedding: [
    {
      id: "ollama",
      label: "Ollama",
      dialect: "ollama-embed",
      base_url: "http://127.0.0.1:11434",
      needs_key: false,
      model: "bge-m3",
    },
    {
      id: "gemini",
      label: "Gemini",
      dialect: "gemini-embed",
      base_url: "https://generativelanguage.googleapis.com",
      needs_key: true,
      model: "gemini-embedding-001",
    },
    {
      id: "openai",
      label: "OpenAI",
      dialect: "openai-embed",
      base_url: "https://api.openai.com/v1",
      needs_key: true,
      model: "text-embedding-3-small",
    },
    {
      id: "compatible",
      label: "OpenAI-compatible",
      dialect: "openai-embed",
      base_url: "http://localhost:8000/v1",
      needs_key: false,
    },
  ],
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Images or Voices: the owner's services in the order they are tried, a test, and (images) the shared defaults. */
export function ServicesSection({ kind, embedded = false }: { kind: ServiceKind; embedded?: boolean }) {
  const t = useT();
  const [services, setServices] = useState<ServiceInfo[]>();
  const [defaults, setDefaults] = useState<ImageDefaults>();
  const [editing, setEditing] = useState<ServiceInfo | "new">();

  const load = useCallback(async () => {
    try {
      const r = await client.call("services.list", { kind });
      setServices(r.services);
      setDefaults(r.image_defaults);
    } catch (e) {
      setServices([]);
      notify(t("error.services", { error: errText(e) }));
    }
  }, [kind, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const call = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    await load();
  };
  const move = (i: number, by: -1 | 1) => {
    if (!services) return;
    const ids = services.map((s) => s.id);
    const [id] = ids.splice(i, 1);
    if (!id) return;
    ids.splice(i + by, 0, id);
    void call(() => client.call("services.order", { kind, ids }));
  };
  const toggle = (s: ServiceInfo, on: boolean) => {
    const { id, key_set: _k, status: _s, ...settings } = s;
    void call(() => client.call("services.set", { id, service: { ...settings, enabled: on } }));
  };

  return (
    <>
      {!embedded && (
        <SectionHead
          title={t(kind === "image" ? "config.images" : "config.voices")}
          lead={t(kind === "image" ? "svc.image.lead" : "svc.speech.lead")}
          actions={
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.RefreshCw size={14} />}
              onClick={() => void load()}
            >
              {t("common.refresh")}
            </Button>
          }
        />
      )}
      {services && !services.length ? (
        <EmptyState
          variant="dashed"
          size="sm"
          icon={kind === "image" ? <Icons.Image /> : kind === "speech" ? <Icons.Mic /> : <Icons.Brain />}
        >
          {t(`svc.${kind}.empty`)}
        </EmptyState>
      ) : (
        <ul className="res__list">
          {services?.map((s, i) => (
            <li key={s.id} className={s.enabled ? "res__row" : "res__row is-off"}>
              <div className="svc__order">
                <IconButton
                  size="sm"
                  label={t("svc.up")}
                  icon={<Icons.ChevronUp size={12} />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  size="sm"
                  label={t("svc.down")}
                  icon={<Icons.ChevronDown size={12} />}
                  disabled={i === services.length - 1}
                  onClick={() => move(i, 1)}
                />
              </div>
              <div className="res__main">
                <div className="res__name">
                  {s.label} <span className="svc__dialect">{s.dialect}</span>
                </div>
                <div className="res__desc res__mono">{s.base_url}</div>
              </div>
              <Badge tone={s.status === "reachable" ? "brand" : s.status === "unreachable" ? "danger" : "neutral"} dot>
                {t(`svc.status.${s.status}`)}
              </Badge>
              <Switch size="sm" checked={s.enabled} onCheckedChange={(on) => toggle(s, on)} label={t("providers.on")} />
              <IconButton
                size="sm"
                label={t("providers.edit")}
                icon={<Icons.Pencil size={14} />}
                onClick={() => setEditing(s)}
              />
              <IconButton
                size="sm"
                label={t("providers.remove")}
                icon={<Icons.Trash2 size={14} />}
                onClick={() => void call(() => client.call("services.set", { id: s.id, service: null }))}
              />
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing("new")}>
          {t("svc.add")}
        </Button>
      </div>

      {!embedded && (kind === "image" ? <ImageTest /> : kind === "speech" ? <SpeechTest /> : null)}
      {!embedded && kind === "speech" && (
        <>
          <SubHead>{t("svc.transcription")}</SubHead>
          <p className="config__lead">{t("svc.transcription.lead")}</p>
          <ServicesSection kind="transcription" embedded />
        </>
      )}
      {!embedded && kind === "image" && defaults && <Defaults value={defaults} onSaved={setDefaults} />}

      {editing && (
        <ServiceDialog
          kind={kind}
          initial={editing === "new" ? undefined : editing}
          taken={services?.map((s) => s.id) ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
    </>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "service";

function ServiceDialog(props: {
  kind: ServiceKind;
  initial: ServiceInfo | undefined;
  taken: string[];
  onClose(): void;
  onSaved(): void;
}) {
  const t = useT();
  const { kind, initial } = props;
  const first = PRESETS[kind][0] as Preset;
  const [draft, setDraft] = useState<ServiceSettings>(() => {
    if (initial) {
      const { id: _i, key_set: _k, status: _s, ...rest } = initial;
      return rest;
    }
    const { id: _p, ...p } = first;
    return { kind, enabled: true, ...p };
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const id = initial?.id ?? slug(draft.label);
  const clash = !initial && props.taken.includes(id);
  const set = (patch: Partial<ServiceSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v !== "" && v !== undefined),
      ) as ServiceSettings;
      await client.call("services.set", { id, service: clean, ...(key ? { api_key: key } : {}) });
      props.onSaved();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      size="lg"
      title={initial ? t("svc.editTitle", { name: initial.label }) : t("svc.newTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={clash || !/^https?:\/\/.+/.test(draft.base_url)} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pform">
        {!initial && (
          <div className="pform__presets">
            {PRESETS[kind].map((p) => (
              <button
                key={p.id}
                type="button"
                className={draft.label === p.label ? "pform__preset is-on" : "pform__preset"}
                onClick={() => {
                  const { id: _p, ...rest } = p;
                  setDraft({ kind, enabled: true, ...rest });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <Field label={t("svc.name")} hint={clash ? t("providers.idTaken", { id }) : undefined}>
          <Input
            aria-label={t("svc.name")}
            value={draft.label}
            onChange={(e) => set({ label: e.currentTarget.value })}
          />
        </Field>
        {/* APX runs whisper.cpp itself: there is no address to give. */}
        {draft.dialect !== "whisper-cpp" && (
          <Field label={t("providers.url")}>
            <Input
              aria-label={t("providers.url")}
              value={draft.base_url}
              onChange={(e) => set({ base_url: e.currentTarget.value })}
            />
          </Field>
        )}
        <Field
          label={t("svc.model")}
          hint={t(
            draft.dialect === "whisper-cpp"
              ? "svc.modelWhisperCppHint"
              : kind === "image"
                ? "svc.modelImageHint"
                : "svc.modelSpeechHint",
          )}
        >
          <Input
            aria-label={t("svc.model")}
            value={draft.model ?? ""}
            onChange={(e) => set({ model: e.currentTarget.value })}
          />
        </Field>
        {kind === "speech" && (
          <>
            <Field label={t("svc.voice")}>
              <Input
                aria-label={t("svc.voice")}
                value={draft.voice ?? ""}
                onChange={(e) => set({ voice: e.currentTarget.value })}
              />
            </Field>
            <Field label={t("svc.language")}>
              <Input
                aria-label={t("svc.language")}
                value={draft.language ?? ""}
                placeholder="es"
                onChange={(e) => set({ language: e.currentTarget.value })}
              />
            </Field>
            <Field label={t("svc.style")} hint={t("svc.styleHint")}>
              <Input
                aria-label={t("svc.style")}
                value={draft.style ?? ""}
                onChange={(e) => set({ style: e.currentTarget.value })}
              />
            </Field>
            {draft.dialect === "openai-speech" && (
              <>
                <Field label={t("svc.clone")} hint={t("svc.cloneHint")}>
                  <Input
                    aria-label={t("svc.clone")}
                    value={draft.clone ?? ""}
                    onChange={(e) => set({ clone: e.currentTarget.value })}
                  />
                </Field>
                {draft.clone && (
                  <Field label={t("svc.refText")} hint={t("svc.refTextHint")}>
                    <Textarea
                      aria-label={t("svc.refText")}
                      rows={2}
                      value={draft.ref_text ?? ""}
                      onChange={(e) => set({ ref_text: e.currentTarget.value })}
                    />
                  </Field>
                )}
                <Field label={t("svc.temperature")} hint={t("svc.temperatureHint")}>
                  <Input
                    aria-label={t("svc.temperature")}
                    type="number"
                    step="0.1"
                    value={draft.temperature === undefined ? "" : String(draft.temperature)}
                    onChange={(e) =>
                      set({ temperature: e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value) })
                    }
                  />
                </Field>
              </>
            )}
          </>
        )}
        <Switch
          checked={draft.needs_key}
          onCheckedChange={(on) => set({ needs_key: on })}
          label={t("svc.needsKey")}
          description={t("svc.needsKeyHint")}
        />
        {draft.needs_key && (
          <Field label={t("providers.key")} hint={t("providers.keyHint")}>
            <Input
              aria-label={t("providers.key")}
              type="password"
              autoComplete="off"
              value={key}
              placeholder={initial?.key_set ? t("providers.keyKeep") : ""}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="pform__field">
      <span className="pform__label">{label}</span>
      {children}
      {hint && <span className="pform__hint">{hint}</span>}
    </div>
  );
}

function ImageTest() {
  const t = useT();
  const [prompt, setPrompt] = useState(t("svc.image.samplePrompt"));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ src: string; by: string }>();
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("media.image", { prompt });
      const first = r.media[0];
      if (first) setResult({ src: await mediaUrl(first.id), by: [r.service, r.model].filter(Boolean).join(" · ") });
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <>
      <SubHead>{t("svc.test")}</SubHead>
      <div className="svc__test">
        <Textarea
          aria-label={t("svc.prompt")}
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />
        <div>
          <Button
            size="sm"
            loading={busy}
            disabled={!prompt.trim()}
            leadingIcon={<Icons.Sparkles size={14} />}
            onClick={() => void run()}
          >
            {t("svc.generate")}
          </Button>
        </div>
        {result && (
          <figure className="svc__result">
            <img src={result.src} alt={prompt} />
            <figcaption>{result.by}</figcaption>
          </figure>
        )}
      </div>
    </>
  );
}

function SpeechTest() {
  const t = useT();
  const [text, setText] = useState(t("svc.speech.sample"));
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<string>();
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("media.speak", { text });
      setBy(r.service);
      void new Audio(await mediaUrl(r.media.id)).play();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <>
      <SubHead>{t("svc.test")}</SubHead>
      <div className="svc__test">
        <Textarea aria-label={t("svc.say")} rows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <div className="tgtoken">
          <Button
            size="sm"
            loading={busy}
            disabled={!text.trim()}
            leadingIcon={<Icons.Volume2 size={14} />}
            onClick={() => void run()}
          >
            {t("svc.say")}
          </Button>
          {by && <span className="pform__hint">{t("svc.spokenBy", { name: by })}</span>}
        </div>
      </div>
    </>
  );
}

function Defaults({ value, onSaved }: { value: ImageDefaults; onSaved(d: ImageDefaults): void }) {
  const t = useT();
  const [d, setD] = useState(value);
  const num = (k: keyof ImageDefaults) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: Number(e.currentTarget.value) || 0 });
  const save = async () => {
    try {
      onSaved(await client.call("services.defaults", d));
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
  };
  return (
    <>
      <SubHead>{t("svc.defaults")}</SubHead>
      <p className="config__lead">{t("svc.defaultsLead")}</p>
      <SettingRow title={t("svc.size")}>
        <div className="tgtoken">
          <Input aria-label={t("svc.width")} type="number" value={String(d.width)} onChange={num("width")} />
          <span>×</span>
          <Input aria-label={t("svc.height")} type="number" value={String(d.height)} onChange={num("height")} />
        </div>
      </SettingRow>
      <SettingRow title={t("svc.steps")}>
        <Input aria-label={t("svc.steps")} type="number" value={String(d.steps)} onChange={num("steps")} />
      </SettingRow>
      <SettingRow title={t("svc.cfg")}>
        <Input aria-label={t("svc.cfg")} type="number" value={String(d.cfg_scale)} onChange={num("cfg_scale")} />
      </SettingRow>
      <SettingRow title={t("svc.count")}>
        <Input aria-label={t("svc.count")} type="number" value={String(d.count)} onChange={num("count")} />
      </SettingRow>
      <SettingRow title={t("svc.negative")} description={t("svc.negativeHint")}>
        <Input
          aria-label={t("svc.negative")}
          value={d.negative_prompt}
          onChange={(e) => setD({ ...d, negative_prompt: e.currentTarget.value })}
        />
      </SettingRow>
      <div>
        <Button size="sm" onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}
