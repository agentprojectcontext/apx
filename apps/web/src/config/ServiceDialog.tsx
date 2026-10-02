import type { ServiceDialect, ServiceInfo, ServiceKind, ServiceSettings } from "@apx/protocol";
import { Button, Dialog, Input, Switch, Textarea } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

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

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "service";

export function ServiceDialog(props: {
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
        {kind === "speech" && <SpeechFields draft={draft} set={set} />}
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

/** Voice, language, style and (OpenAI-compatible speech) cloning knobs. */
function SpeechFields({ draft, set }: { draft: ServiceSettings; set(patch: Partial<ServiceSettings>): void }) {
  const t = useT();
  return (
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
  );
}
