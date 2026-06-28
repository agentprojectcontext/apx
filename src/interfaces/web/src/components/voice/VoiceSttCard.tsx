import { Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { WHISPER_MODELS, type TranscriptionConfig } from "../../lib/api/voice";
import { isSecretMarker, secretSuffix } from "../../lib/secrets";
import { t } from "../../i18n";

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

  return (
    <div className="space-y-3">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("voice_ui.stt_model_label")} hint={t("voice_ui.stt_model_hint")}>
            <UiSelect
              value={model}
              onChange={(v) => onPatch({ "transcription.local.model": v })}
              options={WHISPER_MODELS.map((m) => ({ value: m, label: m }))}
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
