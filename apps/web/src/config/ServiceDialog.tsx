import type { ServiceDialect, ServiceInfo, ServiceKind, ServiceSettings, ServiceTest } from "@apx/protocol";
import { Button, Dialog, Icons, Input, Switch, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { checkText, missingModel, settingsOf, testService } from "./serviceCheck.ts";

type Preset = { id: string; label: string; dialect: ServiceDialect; base_url: string; needs_key: boolean } & Partial<
  Pick<ServiceSettings, "model" | "voice" | "language">
>;

const PRESETS: Record<ServiceKind, Preset[]> = {
  image: [
    {
      id: "codex",
      label: "Codex (ChatGPT plan)",
      dialect: "codex-images",
      base_url: "http://127.0.0.1",
      needs_key: false,
    },
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
      label: "whisper.cpp (local)",
      dialect: "whisper-cpp",
      base_url: "http://127.0.0.1",
      needs_key: false,
      language: "es",
      model: "~/models/ggml-small.bin",
    },
    {
      id: "whisper",
      label: "Whisper (local)",
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
    if (initial) return settingsOf(initial);
    const { id: _p, ...p } = first;
    return { kind, enabled: true, ...p };
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // What "Test connection" found for the address as it is now (cleared when the address or the key change).
  const [check, setCheck] = useState<ServiceTest>();
  const [checking, setChecking] = useState(false);
  const id = initial?.id ?? slug(draft.label);
  const clash = !initial && props.taken.includes(id);
  const set = (patch: Partial<ServiceSettings>) => {
    if ("base_url" in patch || "dialect" in patch || "needs_key" in patch) setCheck(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const validUrl = /^https?:\/\/.+/.test(draft.base_url);
  // APX runs these itself (whisper.cpp) or through the owner's own CLI (Codex): there is no address or key to give.
  const runsHere = draft.dialect === "whisper-cpp" || draft.dialect === "codex-images";
  const runCheck = async () => {
    setChecking(true);
    setCheck(await testService(draft, initial?.id, key || undefined));
    setChecking(false);
  };
  // A saved service is tried as soon as it opens: the owner sees at once whether it answers and what it offers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open
  useEffect(() => {
    if (initial && draft.dialect !== "whisper-cpp") void runCheck();
  }, []);
  const noModel = check && missingModel(t, check, draft);
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
          <Button disabled={clash || !validUrl} loading={busy} onClick={() => void save()}>
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
        {draft.dialect === "codex-images" && <span className="pform__hint">{t("svc.codexHint")}</span>}
        {!runsHere && (
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
              : draft.dialect === "codex-images"
                ? "svc.modelCodexHint"
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
        {check?.models && check.models.length > 0 && (
          <fieldset className="pform__presets pform__models" aria-label={t("svc.model")}>
            {check.models.slice(0, 24).map((m) => (
              <button
                key={m}
                type="button"
                className={draft.model === m ? "pform__preset is-on" : "pform__preset"}
                aria-pressed={draft.model === m}
                onClick={() => set({ model: m })}
              >
                {m}
              </button>
            ))}
          </fieldset>
        )}
        {kind === "speech" && <SpeechFields draft={draft} set={set} />}
        {!runsHere && (
          <Switch
            checked={draft.needs_key}
            onCheckedChange={(on) => set({ needs_key: on })}
            label={t("svc.needsKey")}
            description={t("svc.needsKeyHint")}
          />
        )}
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
        {draft.dialect !== "whisper-cpp" && (
          <div className="pform__check">
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.RefreshCw size={14} />}
              loading={checking}
              disabled={!validUrl || (draft.needs_key && !key && !initial?.key_set)}
              onClick={() => void runCheck()}
            >
              {t("svc.check")}
            </Button>
            {check && !checking && (
              <span role="status" className={check.ok && !noModel ? "pform__hint is-ok" : "pform__hint is-error"}>
                {checkText(t, check)}
                {noModel ? ` ${noModel}` : ""}
              </span>
            )}
          </div>
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
