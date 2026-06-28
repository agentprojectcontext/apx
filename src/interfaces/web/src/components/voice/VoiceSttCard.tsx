import { useEffect, useState } from "react";
import { Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { Voice, WHISPER_MODELS, type TranscriptionConfig, type SttHardwareResponse, type SttModelEntry } from "../../lib/api/voice";
import { isSecretMarker, secretSuffix } from "../../lib/secrets";
import { t } from "../../i18n";

// Acceleration badge — each compute backend gets its own colour so the user can
// tell at a glance what the local engine runs on (Metal on Apple Silicon, CUDA
// on NVIDIA, Vulkan/ROCm on AMD, plain CPU otherwise).
const ACCEL: Record<string, { label: string; cls: string }> = {
  metal: { label: "Metal",         cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
  cuda:  { label: "CUDA",          cls: "text-lime-400 border-lime-500/40 bg-lime-500/10" },
  rocm:  { label: "Vulkan / ROCm", cls: "text-orange-400 border-orange-500/40 bg-orange-500/10" },
  none:  { label: "CPU",           cls: "text-muted-fg border-border bg-muted" },
};

function AccelBadge({ gpu }: { gpu: string }) {
  const a = ACCEL[gpu] ?? ACCEL.none;
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${a.cls}`}>
      {a.label}
    </span>
  );
}

// Human label for the recommended backend (engine + where it runs).
function backendLabel(rec: SttHardwareResponse["recommended"]): string {
  if (rec.backend === "mlx") return "Metal · mlx-whisper";
  if (rec.backend === "faster") return (rec.device === "cuda" ? "CUDA" : "CPU") + " · faster-whisper";
  return rec.backend;
}

// STT (speech-to-text) configuration. Persisted under config.transcription.
// The actual capture happens in the desktop window / Telegram / CLI; here the
// owner picks the engine and configures it:
//   local  — embedded faster-whisper (offline; model + language)
//   openai — OpenAI cloud Whisper (api_key + model)
//   custom — any OpenAI-compatible server: mlx-audio on this Mac's Metal GPU,
//            a Radeon/NVIDIA box on the LAN, or a remote endpoint (base_url).

interface Props {
  config: TranscriptionConfig;
  onPatch: (set: Record<string, unknown>, unset?: string[]) => void;
  busy?: boolean;
}

const providerOptions = () => [
  { value: "auto", label: t("voice_ui.stt_provider_auto") },
  { value: "local", label: t("voice_ui.stt_provider_local") },
  { value: "openai", label: t("voice_ui.stt_provider_openai") },
  { value: "custom", label: t("voice_ui.stt_provider_custom") },
];

const langOptions = () => [
  { value: "auto", label: t("voice_ui.lang_auto") },
  { value: "es", label: t("voice_ui.lang_es") },
  { value: "en", label: t("voice_ui.lang_en") },
  { value: "pt", label: t("voice_ui.lang_pt") },
  { value: "fr", label: t("voice_ui.lang_fr") },
  { value: "it", label: t("voice_ui.lang_it") },
  { value: "de", label: t("voice_ui.lang_de") },
];

export function VoiceSttCard({ config, onPatch, busy }: Props) {
  const [hw, setHw] = useState<SttHardwareResponse | null>(null);
  useEffect(() => {
    let alive = true;
    Voice.sttHardware().then((r) => { if (alive) setHw(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const provider = config.provider || "auto";
  const local = config.local || {};
  const openai = config.openai || {};
  const custom = config.custom || {};
  const model = local.model || "small";
  const language = local.language || "auto";
  // "auto" tries local first, so its tuning shares the local block.
  const showLocal = provider === "auto" || provider === "local";

  // Text fields patch on blur (not every keystroke), and only when changed.
  const patchText = (key: string, prev: string | undefined, value: string) => {
    const next = value.trim();
    if (next === (prev || "").trim()) return;
    onPatch({ [key]: next });
  };
  // Secrets: a blank field keeps the stored key; the daemon ignores redacted
  // "*** set ***" markers, so we never echo one back as a real value.
  const patchKey = (key: string, value: string) => {
    const next = value.trim();
    if (!next || isSecretMarker(next)) return;
    onPatch({ [key]: next });
  };
  const keyPlaceholder = (marker: unknown) =>
    isSecretMarker(marker)
      ? t("voice_ui.api_key_set", { suffix: secretSuffix(marker) ?? "" })
      : t("voice_ui.api_key_label");

  // ── Local engine: acceleration backend + model (hardware-adaptive) ─────────
  const localBackend = local.backend || "auto";
  const accel = hw?.hardware.gpu || "none";
  // What "auto" actually resolves to on this machine (mlx on Metal, faster else).
  const effectiveBackend = localBackend === "auto" ? (hw?.recommended.backend || "faster") : localBackend;
  const isMlx = effectiveBackend === "mlx";
  // The accel a chosen backend runs on — drives the badge next to the selector.
  const selectedAccel = isMlx ? "metal" : (effectiveBackend === "faster" && accel === "cuda" ? "cuda" : "none");

  const backendOptions = () => {
    const opts = [{ value: "auto", label: t("voice_ui.stt_backend_auto") }];
    if (accel === "metal") opts.push({ value: "mlx", label: "Metal — mlx-whisper" });
    opts.push({ value: "faster", label: accel === "cuda" ? "CUDA — faster-whisper" : "CPU — faster-whisper" });
    return opts;
  };

  // Model list for the effective backend, with on-disk status in the label.
  const [models, setModels] = useState<SttModelEntry[]>([]);
  useEffect(() => {
    let alive = true;
    Voice.sttModels(effectiveBackend).then((r) => { if (alive) setModels(r.models); }).catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [effectiveBackend]);

  const fmtModel = (m: SttModelEntry) => `${m.id} · ${m.downloaded ? "✓ " + m.size : m.size}`;
  const modelOptions = () =>
    models.length
      ? models.map((m) => ({ value: isMlx ? m.repo : m.id, label: fmtModel(m) }))
      : WHISPER_MODELS.map((m) => ({ value: m, label: m }));
  const modelValue = isMlx ? (local.mlx_model || hw?.recommended.model || "") : model;
  const modelPatchKey = isMlx ? "transcription.local.mlx_model" : "transcription.local.model";
  const selectedModel = models.find((m) => (isMlx ? m.repo : m.id) === modelValue);
  const needsDownload = !!selectedModel && !selectedModel.downloaded;

  return (
    <div className="space-y-3">
      {hw && (
        <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-fg">{t("voice_ui.stt_hw_label")}:</span>
            <AccelBadge gpu={hw.hardware.gpu} />
            <span className="font-medium text-fg">{hw.hardware.gpuName || hw.hardware.platform}</span>
            {hw.hardware.mem_gb ? (
              <span className="text-muted-fg">
                · {hw.hardware.mem_gb} GB{hw.hardware.unified_memory ? " unified" : ""}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-fg">
            {t("voice_ui.stt_hw_recommended")}:{" "}
            <span className="text-fg">{hw.recommended.model}</span>
            {" "}({backendLabel(hw.recommended)})
            {hw.recommended.limited ? ` — ${t("voice_ui.stt_hw_limited")}` : ""}
          </div>
        </div>
      )}

      <Field label={t("voice_ui.stt_engine_label")} hint={t("voice_ui.stt_engine_hint")}>
        <UiSelect
          value={provider}
          onChange={(v) => onPatch({ "transcription.provider": v })}
          options={providerOptions()}
          disabled={busy}
          className="max-w-md"
        />
      </Field>

      {showLocal && (
        <div className="space-y-3">
          <Field label={t("voice_ui.stt_backend_label")} hint={t("voice_ui.stt_backend_hint")}>
            <div className="flex items-center gap-2">
              <UiSelect
                value={localBackend}
                onChange={(v) => onPatch({ "transcription.local.backend": v })}
                options={backendOptions()}
                disabled={busy}
                className="max-w-xs"
              />
              <AccelBadge gpu={selectedAccel} />
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={t("voice_ui.stt_model_label")}
              hint={needsDownload ? t("voice_ui.stt_model_needs_download", { size: selectedModel!.size }) : t("voice_ui.stt_model_hint")}
            >
              <UiSelect
                value={modelValue}
                onChange={(v) => onPatch({ [modelPatchKey]: v })}
                options={modelOptions()}
                disabled={busy}
              />
            </Field>
            <Field label={t("voice_ui.stt_language_label")} hint={t("voice_ui.stt_language_hint")}>
              <UiSelect
                value={language}
                onChange={(v) => onPatch({ "transcription.local.language": v })}
                options={langOptions()}
                disabled={busy}
              />
            </Field>
          </div>
        </div>
      )}

      {provider === "openai" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={t("voice_ui.api_key_label")}
            hint={isSecretMarker(openai.api_key)
              ? t("voice_ui.api_key_keep_hint")
              : t("voice_ui.api_key_reuse_hint", { engine: "engines.openai.api_key", env: "OPENAI_API_KEY" })}
          >
            <Input
              type="password"
              autoComplete="new-password"
              defaultValue=""
              placeholder={keyPlaceholder(openai.api_key)}
              onBlur={(e) => patchKey("transcription.openai.api_key", e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label={t("voice_ui.stt_openai_model_label")} hint={t("voice_ui.stt_openai_model_hint")}>
            <Input
              defaultValue={openai.model || ""}
              placeholder="whisper-1"
              onBlur={(e) => patchText("transcription.openai.model", openai.model, e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>
      )}

      {provider === "custom" && (
        <div className="space-y-3">
          <Field label={t("voice_ui.stt_custom_baseurl_label")} hint={t("voice_ui.stt_custom_baseurl_hint")}>
            <Input
              defaultValue={custom.base_url || ""}
              placeholder="http://localhost:8000/v1"
              onBlur={(e) => patchText("transcription.custom.base_url", custom.base_url, e.target.value)}
              disabled={busy}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("voice_ui.stt_custom_model_label")} hint={t("voice_ui.stt_custom_model_hint")}>
              <Input
                defaultValue={custom.model || ""}
                placeholder="mlx-community/whisper-large-v3-turbo"
                onBlur={(e) => patchText("transcription.custom.model", custom.model, e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label={t("voice_ui.stt_language_label")} hint={t("voice_ui.stt_language_hint")}>
              <UiSelect
                value={custom.language || "auto"}
                onChange={(v) => onPatch({ "transcription.custom.language": v })}
                options={langOptions()}
                disabled={busy}
              />
            </Field>
          </div>
          <Field label={t("voice_ui.api_key_label")} hint={t("voice_ui.stt_custom_key_hint")}>
            <Input
              type="password"
              autoComplete="new-password"
              defaultValue=""
              placeholder={keyPlaceholder(custom.api_key)}
              onBlur={(e) => patchKey("transcription.custom.api_key", e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
