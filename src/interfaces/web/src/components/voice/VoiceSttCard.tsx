import { Field } from "../ui";
import { UiSelect } from "../UiSelect";
import { WHISPER_MODELS, type TranscriptionConfig } from "../../lib/api/voice";
import { t } from "../../i18n";

// STT (speech-to-text) configuration. Persisted under config.transcription.
// The actual capture happens in the deck overlay / Telegram / CLI; here the
// owner just picks the backend + (for local whisper) the model + language.

interface Props {
  config: TranscriptionConfig;
  onPatch: (set: Record<string, unknown>, unset?: string[]) => void;
  busy?: boolean;
}

const providerOptions = () => [
  { value: "auto", label: t("voice_ui.stt_provider_auto") },
  { value: "local", label: t("voice_ui.stt_provider_local") },
  { value: "openai", label: t("voice_ui.stt_provider_openai") },
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
  const model = local.model || "small";
  const language = local.language || "auto";
  const usesLocal = provider !== "openai";

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

      {usesLocal && (
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
    </div>
  );
}
